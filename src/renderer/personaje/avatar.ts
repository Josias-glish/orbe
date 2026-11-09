import type { IdExpresion } from '../../shared/expresiones'
import type { EstadoOrbe } from '../../shared/tipos'
import type { IdGesto } from './gestos'

/** Gestos del usuario y cosas del entorno (te fuiste, volviste) que provocan una reacción. */
export type Reaccion = 'encima' | 'fuera' | 'arrastre' | 'soltar' | 'abrir' | 'caricia' | 'despertar' | 'ausente' | 'vuelve'

/**
 * Lo que la interfaz necesita de la figura de la esquina, sea el orbe clásico, el personaje dibujado o uno de Rive.
 * El panel solo habla con esto: cambiar de figura no toca el chat.
 */
export interface Avatar {
  establecerEstado(estado: EstadoOrbe): void
  obtenerEstado(): EstadoOrbe
  /** Llegó un trozo de respuesta en streaming. */
  pulso(intensidad?: number): void
  fijarVisible(visible: boolean): void
  iniciar(): void
  detener(): void
  diagnostico(): Record<string, unknown>
  /** Pone una expresión durante `duracionMs` (0 = hasta que se quite con `null`). El orbe clásico la ignora. */
  expresar(id: IdExpresion | null, duracionMs?: number): void
  /** La expresión que se ve ahora mismo. */
  expresionActual(): IdExpresion | null
  /** El cursor, en coordenadas de pantalla: el personaje lo sigue con la mirada. */
  mirarA(x: number, y: number): void
  reaccionar(reaccion: Reaccion): void
  /** Un gesto de todo el cuerpo (saludar, saltar, bailar…). El orbe clásico lo ignora. */
  gesto?(id: IdGesto, conCara?: boolean): void
}
