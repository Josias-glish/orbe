import type { EstadoOrbe } from '../../shared/tipos'

/** Parámetros visuales que cada estado del orbe empuja hacia su valor objetivo. */
export interface ParametrosOrbe {
  /** Velocidad de la deriva del ruido (unidades de fase por segundo). */
  velocidad: number
  amplitud: number
  turbulencia: number
  brillo: number
  /** Nivel base de las ondas; los pulsos del streaming lo superan de forma transitoria. */
  energia: number
}

export const PARAMETROS: Record<EstadoOrbe, ParametrosOrbe> = {
  reposo: { velocidad: 0.12, amplitud: 0.07, turbulencia: 0.0, brillo: 0.7, energia: 0 },
  leyendo: { velocidad: 0.3, amplitud: 0.09, turbulencia: 0.15, brillo: 0.95, energia: 0 },
  pensando: { velocidad: 0.85, amplitud: 0.17, turbulencia: 0.9, brillo: 0.9, energia: 0 },
  respondiendo: { velocidad: 0.35, amplitud: 0.1, turbulencia: 0.25, brillo: 1.0, energia: 0.3 },
  // Reservado para la voz: respira de forma suave y marcada.
  escuchando: { velocidad: 0.22, amplitud: 0.13, turbulencia: 0.1, brillo: 1.0, energia: 0.18 }
}

/** Frecuencia máxima de dibujado según el estado: en reposo basta con 30 fps. */
export function fpsMaximos(estado: EstadoOrbe): number {
  return estado === 'reposo' ? 30 : 60
}

/** Acerca `actual` a `objetivo` de forma exponencial, independiente de los fps. */
export function suavizar(actual: number, objetivo: number, dt: number, tau: number): number {
  return objetivo + (actual - objetivo) * Math.exp(-dt / tau)
}

/** Duración del destello de «leyendo», en segundos. */
export const DURACION_BARRIDO = 1.2
