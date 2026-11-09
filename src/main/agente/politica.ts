import { decisionPorRegla, modoDe, REGLAS_POR_DEFECTO, type Modo } from './reglas'
import type { Decision, Herramienta } from './tipos'

export interface OpcionesPolitica {
  /** Las reglas de `reglas.json` (sin ellas, las de por defecto). Los mínimos fijos se aplican siempre. */
  reglas?: Readonly<Record<string, Modo>>
  /** La orden original del usuario en esta tarea: decide las acciones «si_lo_pediste». */
  ordenUsuario?: string
}

/** Cuánto pesa cada decisión: de dos opiniones, gana la más estricta. */
const PESO: Record<Decision['tipo'], number> = { permitir: 0, confirmar: 1, prohibir: 2 }

/**
 * Decide, antes de ejecutar, si una llamada se hace, se pregunta o se niega. Una instancia vive lo que dura una tarea:
 * el modelo no puede saltársela porque las herramientas solo se ejecutan a través de ella.
 */
export class Politica {
  private vigilando = false
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

  decidir(herramienta: Herramienta, entrada: unknown, titulo: string): Decision {
    const propia = herramienta.clasificar?.(entrada)
    let base: Decision
    if (herramienta.accion) {
      // Herramienta de conector: manda la regla, y la propia herramienta solo puede endurecerla.
      const regla = decisionPorRegla(herramienta.accion, modoDe(herramienta.accion, this.reglas), titulo, this.opciones.ordenUsuario)
      base = propia && PESO[propia.tipo] > PESO[regla.tipo] ? propia : regla
    } else {
      base = propia ?? (herramienta.nivel === 'confirmar' ? { tipo: 'confirmar', titulo, detalle: 'Esta acción necesita tu permiso.' } : { tipo: 'permitir' })
    }
    if (base.tipo === 'permitir' && this.vigilando) {
      return {
        tipo: 'confirmar',
        titulo,
        detalle: 'Leí algo con instrucciones sospechosas, así que desde ahora te pido permiso para cada acción de esta tarea.',
        peligrosa: true
      }
    }
    return base
  }
}
