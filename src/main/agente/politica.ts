import { decisionPorRegla, modoDe, REGLAS_POR_DEFECTO, type Modo } from './reglas'
import type { Decision, Herramienta } from './tipos'
import { recortar } from './validacion'

export interface OpcionesPolitica {
  /** Las reglas de `reglas.json` (sin ellas, las de por defecto). Los mínimos fijos se aplican siempre. */
  reglas?: Readonly<Record<string, Modo>>
  /** La orden original del usuario en esta tarea: decide las acciones «si_lo_pediste». */
  ordenUsuario?: string
  /**
   * Modo auto (decisión del usuario, 12-nov): se hace todo sin preguntar, también enviar o publicar. Siguen igual lo
   * bloqueado (pagos, compras, contraseñas, cuentas ajenas de Instagram) y el modo vigilado (contenido de fuera con
   * órdenes sospechosas), que vuelve a preguntar cada acción.
   */
  auto?: boolean
}

/**
 * Lo que nunca se aprueba «para esta tarea»: publicar, enviar, responder, subir o borrar se aprueba cada vez (tu regla).
 * ponytail: se decide por el nombre de la acción y el título; algo raro que no case se pregunta cada vez, que es lo seguro.
 */
const ENVIO = /publi|respond|env[ií]|reenv|borr|elimin|sub[ei]|send|post|reply|upload|share|forward|delete|remove/i

/** Cuánto pesa cada decisión: de dos opiniones, gana la más estricta. */
const PESO: Record<Decision['tipo'], number> = { permitir: 0, confirmar: 1, prohibir: 2 }

/**
 * Decide, antes de ejecutar, si una llamada se hace, se pregunta o se niega. Una instancia vive lo que dura una tarea:
 * el modelo no puede saltársela porque las herramientas solo se ejecutan a través de ella.
 */
export class Politica {
  private vigilando = false
  /** Tipos de acción que el usuario aprobó para el resto de la tarea. */
  private readonly preaprobadas = new Set<string>()
  /** De dónde vino el contenido de fuera leído en esta tarea (para el revisor). */
  private readonly externos = new Set<string>()
  private readonly reglas: Readonly<Record<string, Modo>>

  constructor(private readonly opciones: OpcionesPolitica = {}) {
    this.reglas = opciones.reglas ?? REGLAS_POR_DEFECTO
  }

  /** Pasa al modo vigilado: desde ahora hasta el final de la tarea, incluso lo libre pide permiso. */
  vigilar(): void {
    this.vigilando = true
  }

  get vigilada(): boolean {
    return this.vigilando
  }

  /** «Permitir en esta tarea»: este tipo de acción ya no se pregunta hasta que termine la tarea. */
  preaprobar(herramienta: Herramienta, entrada: unknown): void {
    this.preaprobadas.add(claveDe(herramienta, entrada))
  }

  /** Se leyó contenido de fuera: el revisor lo recordará en cada permiso que pida después. */
  leyoExterno(origen: string): void {
    this.externos.add(origen)
  }

  decidir(herramienta: Herramienta, entrada: unknown, titulo: string): Decision {
    const propia = herramienta.clasificar?.(entrada)
    let base: Decision
    const accion = herramienta.accionDe?.(entrada) ?? herramienta.accion
    if (accion) {
      // Herramienta de conector: manda la regla, y la propia herramienta solo puede endurecerla.
      const regla = decisionPorRegla(accion, modoDe(accion, this.reglas), titulo, this.opciones.ordenUsuario)
      base = propia && PESO[propia.tipo] > PESO[regla.tipo] ? propia : regla
    } else {
      base = propia ?? (herramienta.nivel === 'confirmar' ? { tipo: 'confirmar', titulo, detalle: 'Esta acción necesita tu permiso.' } : { tipo: 'permitir' })
    }
    if (base.tipo === 'permitir' && this.vigilando) {
      base = {
        tipo: 'confirmar',
        titulo,
        detalle: 'Leí algo con instrucciones sospechosas, así que desde ahora te pido permiso para cada acción de esta tarea.',
        peligrosa: true
      }
    }
    if (base.tipo !== 'confirmar') return base
    const porTarea = base.porTarea !== false && base.peligrosa !== true && !this.vigilando && !ENVIO.test(`${accion ?? herramienta.nombre} ${titulo}`)
    if (porTarea && this.preaprobadas.has(claveDe(herramienta, entrada))) return { tipo: 'permitir' }
    if (this.opciones.auto && !this.vigilando) return { tipo: 'permitir' }
    const revision = this.revisar()
    return { ...base, porTarea, ...(revision ? { revision } : {}) }
  }

  /** El revisor (N4): antes de cada permiso, te recuerda tu orden y si la acción llega después de leer algo de fuera. */
  private revisar(): string | undefined {
    const notas: string[] = []
    if (this.externos.size > 0) {
      notas.push(`Antes leí contenido de fuera (${[...this.externos].join(', ')}): comprueba que esto lo pediste tú y no venía ahí.`)
    }
    if (this.opciones.ordenUsuario) notas.push(`Tu orden: «${recortar(this.opciones.ordenUsuario, 160)}»`)
    return notas.length > 0 ? notas.join('\n') : undefined
  }
}

/** El tipo de acción que aprueba «para esta tarea»: la herramienta y su acción de conector (p. ej. composio.escribir). */
const claveDe = (h: Herramienta, entrada: unknown): string => `${h.nombre}|${h.accionDe?.(entrada) ?? h.accion ?? ''}`
