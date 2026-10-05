import type { Decision, Herramienta } from './tipos'

/**
 * Decide, antes de ejecutar, si una llamada se hace, se pregunta o se niega. Una instancia vive lo que dura una tarea:
 * el modelo no puede saltársela porque las herramientas solo se ejecutan a través de ella.
 */
export class Politica {
  private vigilando = false

  /** Pasa al modo vigilado: desde ahora hasta el final de la tarea, incluso lo libre pide permiso. */
  vigilar(): void {
    this.vigilando = true
  }

  get vigilada(): boolean {
    return this.vigilando
  }

  decidir(herramienta: Herramienta, entrada: unknown, titulo: string): Decision {
    const propia = herramienta.clasificar?.(entrada)
    const base: Decision =
      propia ?? (herramienta.nivel === 'confirmar' ? { tipo: 'confirmar', titulo, detalle: 'Esta acción necesita tu permiso.' } : { tipo: 'permitir' })
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
