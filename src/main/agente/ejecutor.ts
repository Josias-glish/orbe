import type { AccionVista } from '../../shared/tipos'
import { envolverExterno } from './envoltorio'
import type { Politica } from './politica'
import type { RegistroHerramientas } from './registro'
import type { LlamadaHerramienta, PeticionConfirmacion, ResultadoLlamada } from './tipos'
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
  /** Pregunta al usuario; sin esto (p. ej. en pruebas) toda confirmación se da por negada. */
  confirmar?(peticion: PeticionConfirmacion): Promise<boolean>
  /** Marca única de la tarea para envolver el contenido externo. */
  nonce: string
  permitirLocal: boolean
  nuevoId?: () => string
}

const CANCELADO = 'Cancelado por el usuario.'

class Cancelado extends Error {}

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

  constructor(private readonly deps: DepsEjecutor) {}

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
      const decision = politica.decidir(herramienta, entrada, titulo)
      if (decision.tipo === 'prohibir') {
        const motivo = `PROHIBIDO: ${decision.motivo} No lo intentes de otra manera: detén la tarea y pídele al usuario que lo haga él mismo.`
        alAccion(vista({ titulo, parametros, estado: 'denegada', resultado: recortar(decision.motivo, MAX_RESULTADO_VISTA) }))
        return error(motivo)
      }
      if (decision.tipo === 'confirmar') {
        const permitido = this.deps.confirmar
          ? await conSenal(this.deps.confirmar({ titulo: decision.titulo, detalle: decision.detalle, peligrosa: decision.peligrosa }), senal)
          : false
        if (!permitido) {
          alAccion(vista({ titulo, parametros, estado: 'denegada', resultado: 'No la permitiste.' }))
          return error('El usuario no permitió esta acción. No la repitas ni busques otra forma de hacerla; pregúntale cómo quiere seguir.')
        }
      }

      const r = await conSenal(
        herramienta.ejecutar(entrada, {
          senal,
          permitirLocal: this.deps.permitirLocal,
          preguntar: (peticion) => (this.deps.confirmar ? conSenal(this.deps.confirmar(peticion), senal) : Promise.resolve(false)),
          vigilar: () => politica.vigilar()
        }),
        senal
      )
      const texto = r.texto.length > MAX_RESULTADO ? `${r.texto.slice(0, MAX_RESULTADO)}\n[…resultado recortado]` : r.texto
      alAccion(vista({ titulo, parametros, estado: 'ok', resultado: recortar(r.texto, MAX_RESULTADO_VISTA) }))
      return {
        id: llamada.id,
        contenido: r.externo ? envolverExterno(texto, { ...r.externo, nonce: this.deps.nonce }) : texto,
        esError: false
      }
    } catch (e) {
      if (e instanceof Cancelado || senal.aborted) {
        alAccion(vista({ titulo, parametros, estado: 'cancelada', resultado: 'Detenida.' }))
        return error(CANCELADO)
      }
      const motivo = textoDeError(e)
      alAccion(vista({ titulo, parametros, estado: 'error', resultado: motivo }))
      return error(`Error: ${motivo}`)
    }
  }
}
