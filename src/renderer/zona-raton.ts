/** El rectángulo de la caja del personaje, en coordenadas de la ventana. */
export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * ¿Está el punto en la parte central del personaje? Es una elipse algo más baja que el centro de la caja (el cuerpo
 * y la cabeza, sin las puntas de las orejas ni las esquinas vacías). Solo ahí se puede tocar, arrastrar o acariciar
 * al personaje; el resto de la caja deja pasar los clics a lo que haya debajo.
 */
export function enCentroPersonaje(x: number, y: number, r: Rect): boolean {
  if (r.width <= 0 || r.height <= 0) return false
  const cx = r.left + r.width * 0.5
  const cy = r.top + r.height * 0.54
  const rx = r.width * 0.3
  const ry = r.height * 0.4
  const dx = (x - cx) / rx
  const dy = (y - cy) / ry
  return dx * dx + dy * dy <= 1
}

/** Lo que decide si la ventana debe recibir el ratón en un punto. */
export interface EstadoZona {
  /** Hay un arrastre en curso (de la ventana o de un borde): no se suelta el ratón a mitad. */
  arrastrando: boolean
  /** El panel del chat está abierto y el puntero está encima de él. */
  sobrePanel: boolean
  /** El puntero está sobre un botón propio de la esquina (detener la tarea, el globito de avisos). */
  sobreBoton: boolean
  enCentro: boolean
}

export function zonaInteractiva(e: EstadoZona): boolean {
  return e.arrastrando || e.sobrePanel || e.sobreBoton || e.enCentro
}
