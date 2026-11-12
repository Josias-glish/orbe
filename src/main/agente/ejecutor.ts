import type { AccionVista, FuenteVista, RespuestaPermiso } from '../../shared/tipos'
import { envolverExterno } from './envoltorio'
import { normalizarFuentes } from './fuentes'
import type { Politica } from './politica'
import type { RegistroHerramientas } from './registro'
import { AccionProhibida, type LlamadaHerramienta, type PeticionConfirmacion, type ResultadoLlamada } from './tipos'
import { recortar } from './validacion'

/** Tope de lo que se le devuelve al modelo por cada herramienta: una página enorme no puede desbordar el contexto. */
export const MAX_RESULTADO = 12_000
const MAX_PARAMETROS_VISTA = 300
const MAX_RESULTADO_VISTA = 400

export interface DepsEjecutor {
  registro: RegistroHerramientas
  politica: Politica
  senal: AbortSignal
  alAccion(accion: AccionVista): void
  /** Una herramienta aportó fuentes (enlaces) para enseñar bajo la respuesta. */
  alFuentes?(fuentes: FuenteVista[]): void
  /** Pregunta al usuario; sin esto (p. ej. en pruebas) toda confirmación se da por negada. */
  confirmar?(peticion: PeticionConfirmacion): Promise<RespuestaPermiso>
  /** Marca única de la tarea para envolver el contenido externo. */
  nonce: string
  permitirLocal: boolean
  /** Dominios permitidos para las herramientas web (vacío: todos los públicos). */
  dominios?: readonly string[]
  nuevoId?: () => string
  /** Reloj del vigilante (las pruebas lo fijan). */
  ahora?: () => number
}

/** El vigilante pausa la tarea si la misma llamada se repite tantas veces… */
export const REPETICIONES_BUCLE = 3
/** …o si hay tantas acciones en menos de `RAFAGA_MS`. */
export const RAFAGA = 12
const RAFAGA_MS = 60_000

/** Texto de fuera que intenta dar órdenes: desde ahí toda acción de la tarea pide permiso. */
const SOSPECHOSO =
  /ignora (todo |todas |las |lo )?(anterior|instrucciones|lo dicho)|olvida (tus|las) instrucciones|ignore (all |any |the )?(previous|prior|above) instructions|no se lo digas al usuario|do not tell the user|system prompt|eres ahora|you are now/i

const CANCELADO = 'Cancelado por el usuario.'

class Cancelado extends Error {}

/** Lo que recibe el modelo cuando algo está prohibido: parar y pedírselo al usuario, sin buscar otro camino. */
const mensajeProhibido = (motivo: string): string =>
  `PROHIBIDO: ${motivo} No lo intentes de otra manera: detén la tarea y pídele al usuario que lo haga él mismo.`

/** Se resuelve con lo que haga `promesa`, pero se rinde al instante si el usuario detiene la tarea. */
function conSenal<T>(promesa: Promise<T>, senal: AbortSignal): Promise<T> {
  if (senal.aborted) return Promise.reject(new Cancelado())
  return new Promise<T>((resolver, rechazar) => {
    const alAbortar = (): void => rechazar(new Cancelado())
    senal.addEventListener('abort', alAbortar, { once: true })
    promesa.then(
      (valor) => {
        senal.removeEventListener('abort', alAbortar)
        resolver(valor)
      },
      (error) => {
        senal.removeEventListener('abort', alAbortar)
        rechazar(error)
      }
    )
  })
}

function textoDeError(error: unknown): string {
  return recortar(error instanceof Error ? error.message : String(error), 500)
}

/**
 * Ejecuta las llamadas del modelo: valida los parámetros, consulta la política (libre, confirmar o prohibido),
 * ejecuta la herramienta y cuenta cada paso en el registro visible del chat. Siempre devuelve un resultado por
 * llamada, aunque falle, se niegue o se cancele: las dos APIs lo exigen.
 */
export class EjecutorHerramientas {
  private contador = 0
  private readonly repetidas = new Map<string, number>()
  private recientes: number[] = []

  constructor(private readonly deps: DepsEjecutor) {}

  /**
   * El vigilante (N7): una llamada idéntica repetida (posible bucle) o una ráfaga de acciones pausan la tarea hasta que
   * el usuario diga si sigue. Devuelve el motivo, o null si todo va normal.
   */
  private vigilante(firma: string): string | null {
    const ahora = this.deps.ahora?.() ?? Date.now()
    this.recientes = [...this.recientes.filter((t) => ahora - t < RAFAGA_MS), ahora]
    const veces = (this.repetidas.get(firma) ?? 0) + 1
    this.repetidas.set(firma, veces)
    if (veces >= REPETICIONES_BUCLE) {
      this.repetidas.delete(firma)
      return `Es la ${veces}.ª vez que pido exactamente la misma acción con los mismos datos: puede que esté en un bucle.`
    }
    if (this.recientes.length >= RAFAGA) {
      this.recientes = []
      return `Llevo ${RAFAGA} acciones en menos de un minuto, más rápido de lo normal.`
    }
    return null
  }

  private id(): string {
    return this.deps.nuevoId ? this.deps.nuevoId() : `accion-${++this.contador}`
  }

  async ejecutar(llamada: LlamadaHerramienta): Promise<ResultadoLlamada> {
    const { registro, politica, senal, alAccion } = this.deps
    const error = (contenido: string): ResultadoLlamada => ({ id: llamada.id, contenido, esError: true })
    if (senal.aborted) return error(CANCELADO)

    const herramienta = registro.buscar(llamada.nombre)
    if (!herramienta) {
      return error(`No existe la herramienta «${llamada.nombre}». Las disponibles son: ${registro.nombres.join(', ') || 'ninguna'}.`)
    }

    const accionId = this.id()
    const vista = (parcial: Pick<AccionVista, 'titulo' | 'parametros'> & Partial<AccionVista>): AccionVista => ({
      accionId,
      herramienta: herramienta.nombre,
      estado: 'en_curso',
      ...parcial
    })
    const parametros = recortar(JSON.stringify(llamada.entrada ?? null), MAX_PARAMETROS_VISTA)

    if (llamada.errorEntrada) {
      const motivo = `Los parámetros no son un JSON válido (${llamada.errorEntrada}). Vuelve a llamar a la herramienta con un objeto JSON correcto.`
      alAccion(vista({ titulo: herramienta.nombre, parametros, estado: 'error', resultado: recortar(motivo, MAX_RESULTADO_VISTA) }))
      return error(motivo)
    }
    const validada = herramienta.validar(llamada.entrada)
    if (!validada.ok) {
      const motivo = `Parámetros no válidos: ${validada.error}`
      alAccion(vista({ titulo: herramienta.nombre, parametros, estado: 'error', resultado: recortar(motivo, MAX_RESULTADO_VISTA) }))
      return error(motivo)
    }
    const entrada = validada.valor
    const titulo = recortar(herramienta.describir(entrada), 160)
    alAccion(vista({ titulo, parametros }))

    try {
      const alarma = this.vigilante(`${herramienta.nombre}:${parametros}`)
      if (alarma) {
        const seguir = this.deps.confirmar
          ? await conSenal(
              this.deps.confirmar({ titulo: 'Pausé la tarea por seguridad', detalle: `${alarma} ¿Sigo?`, peligrosa: true, etiquetaPermitir: 'Seguir', etiquetaCancelar: 'Detener' }),
              senal
            )
          : false
        if (!seguir) {
          alAccion(vista({ titulo, parametros, estado: 'denegada', resultado: 'La pausaste.' }))
          return error('El usuario detuvo la tarea por seguridad. No sigas actuando: resume lo hecho y pregúntale cómo quiere seguir.')
        }
      }
      const decision = politica.decidir(herramienta, entrada, titulo)
      if (decision.tipo === 'prohibir') {
        alAccion(vista({ titulo, parametros, estado: 'denegada', resultado: recortar(decision.motivo, MAX_RESULTADO_VISTA) }))
        return error(mensajeProhibido(decision.motivo))
      }
      if (decision.tipo === 'confirmar') {
        const { tipo: _, ...peticion } = decision
        const permitido = this.deps.confirmar ? await conSenal(this.deps.confirmar(peticion), senal) : false
        if (permitido === 'tarea') politica.preaprobar(herramienta, entrada)
        if (!permitido) {
          alAccion(vista({ titulo, parametros, estado: 'denegada', resultado: 'No la permitiste.' }))
          return error('El usuario no permitió esta acción. No la repitas ni busques otra forma de hacerla; pregúntale cómo quiere seguir.')
        }
      }

      const r = await conSenal(
        herramienta.ejecutar(entrada, {
          senal,
          permitirLocal: this.deps.permitirLocal,
          dominios: this.deps.dominios,
          preguntar: (peticion) =>
            this.deps.confirmar ? conSenal(this.deps.confirmar(peticion), senal).then((r) => r !== false) : Promise.resolve(false),
          vigilar: () => politica.vigilar()
        }),
        senal
      )
      const texto = r.texto.length > MAX_RESULTADO ? `${r.texto.slice(0, MAX_RESULTADO)}\n[…resultado recortado]` : r.texto
      alAccion(vista({ titulo, parametros, estado: 'ok', resultado: recortar(r.texto, MAX_RESULTADO_VISTA) }))
      if (r.externo) {
        politica.leyoExterno(r.externo.origen)
        if (SOSPECHOSO.test(r.texto)) politica.vigilar()
      }
      const fuentes = normalizarFuentes(r.fuentes ?? [])
      if (fuentes.length > 0) this.deps.alFuentes?.(fuentes)
      return {
        id: llamada.id,
        contenido: r.externo ? envolverExterno(texto, { ...r.externo, nonce: this.deps.nonce }) : texto,
        esError: false,
        ...(r.imagen ? { imagen: r.imagen } : {})
      }
    } catch (e) {
      if (e instanceof Cancelado || senal.aborted) {
        alAccion(vista({ titulo, parametros, estado: 'cancelada', resultado: 'Detenida.' }))
        return error(CANCELADO)
      }
      if (e instanceof AccionProhibida) {
        alAccion(vista({ titulo, parametros, estado: 'denegada', resultado: recortar(e.message, MAX_RESULTADO_VISTA) }))
        return error(mensajeProhibido(e.message))
      }
      const motivo = textoDeError(e)
      alAccion(vista({ titulo, parametros, estado: 'error', resultado: motivo }))
      return error(`Error: ${motivo}`)
    }
  }
}
