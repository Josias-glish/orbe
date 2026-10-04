/** Tipos y canales compartidos entre el proceso principal, el preload y la interfaz. */

export type EstadoOrbe = 'reposo' | 'leyendo' | 'pensando' | 'respondiendo' | 'escuchando'

export const CANALES = {
  alternar: 'ventana:alternar',
  arrastreInicio: 'ventana:arrastre-inicio',
  arrastreMover: 'ventana:arrastre-mover',
  arrastreFin: 'ventana:arrastre-fin',
  expandidoCambio: 'ventana:expandido-cambio',
  visibilidad: 'ventana:visibilidad'
} as const

export interface EstadoVentana {
  expandido: boolean
  /** Hacia dónde crece el panel respecto al orbe, para anclar el diseño. */
  ancla: { horizontal: 'izquierda' | 'derecha'; vertical: 'arriba' | 'abajo' }
}

export interface ApiOrbe {
  alternar(): void
  arrastreInicio(x: number, y: number): void
  arrastreMover(x: number, y: number): void
  arrastreFin(): void
  alCambiarExpandido(cb: (estado: EstadoVentana) => void): () => void
  alCambiarVisibilidad(cb: (visible: boolean) => void): () => void
}
