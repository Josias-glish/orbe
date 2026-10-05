import type { MotivoFin } from '../../shared/tipos'
import type { LlamadaHerramienta, ResultadoLlamada } from './tipos'

/** Cómo terminó una vuelta al modelo. */
export type FinPaso =
  /** Pide usar herramientas nuestras: hay que ejecutarlas y devolverle los resultados. */
  | 'herramientas'
  /** La API pausó un turno largo (búsqueda web): se reenvía lo mismo para que siga. */
  | 'pausa'
  | 'completo'
  | 'limite_tokens'

export interface RespuestaPaso {
  fin: FinPaso
  llamadas: LlamadaHerramienta[]
}

export interface ModoPaso {
  /** Última vuelta tras el límite de pasos: el modelo debe resumir lo hecho sin pedir más herramientas. */
  sinHerramientas: boolean
}

export interface OpcionesBucle {
  /**
   * Una vuelta al modelo. Cada proveedor la implementa con su propio historial: si trae `resultados`, los añade
   * como respuesta a las herramientas pedidas en la vuelta anterior antes de llamar.
   */
  paso(resultados: ResultadoLlamada[] | null, modo: ModoPaso): Promise<RespuestaPaso>
  ejecutar(llamada: LlamadaHerramienta): Promise<ResultadoLlamada>
  /** Máximo de rondas en las que el modelo puede pedir herramientas en una tarea. */
  maxPasos: number
  senal: AbortSignal
}

export interface ResultadoBucle {
  motivo: MotivoFin
  /** Rondas de herramientas que se ejecutaron. */
  pasos: number
  /**
   * Si se detuvo con herramientas pedidas y aún sin responder, lo que ya se había obtenido de ellas. El proveedor
   * rellena el resto como «cancelado» para dejar el historial válido.
   */
  pendientes: ResultadoLlamada[]
}

/** Continuaciones seguidas de `pause_turn` que se aceptan antes de dar el turno por terminado. */
export const MAX_PAUSAS = 5

const CANCELADO = 'Cancelado por el usuario.'

/**
 * El bucle del agente: el modelo elige herramientas, la aplicación las ejecuta y le devuelve los resultados, y
 * así hasta que termina la tarea, se llega al límite de pasos o el usuario pulsa Detener.
 */
export async function ejecutarBucle(o: OpcionesBucle): Promise<ResultadoBucle> {
  let resultados: ResultadoLlamada[] | null = null
  let pasos = 0
  let pausas = 0
  let hechos: ResultadoLlamada[] = []

  try {
    for (;;) {
      if (o.senal.aborted) return { motivo: 'cancelado', pasos, pendientes: [] }
      const r = await o.paso(resultados, { sinHerramientas: false })
      hechos = []

      if (r.fin === 'pausa') {
        if (++pausas > MAX_PAUSAS) return { motivo: 'completo', pasos, pendientes: [] }
        resultados = null
        continue
      }
      pausas = 0
      if (r.fin === 'completo' || r.fin === 'limite_tokens' || r.llamadas.length === 0) {
        return { motivo: r.fin === 'limite_tokens' ? 'limite_tokens' : 'completo', pasos, pendientes: [] }
      }

      if (pasos >= o.maxPasos) {
        // Tope alcanzado: las llamadas pendientes no se ejecutan y se le pide un resumen sin herramientas.
        const sinEjecutar = r.llamadas.map((l) => ({
          id: l.id,
          contenido: 'No se ejecutó: la tarea alcanzó su límite de pasos. Resume al usuario lo que lograste y lo que falta.',
          esError: true
        }))
        await o.paso(sinEjecutar, { sinHerramientas: true })
        return { motivo: 'limite_pasos', pasos, pendientes: [] }
      }
      pasos++

      for (const llamada of r.llamadas) {
        hechos.push(o.senal.aborted ? { id: llamada.id, contenido: CANCELADO, esError: true } : await o.ejecutar(llamada))
      }
      if (o.senal.aborted) return { motivo: 'cancelado', pasos, pendientes: hechos }
      resultados = hechos
    }
  } catch (e) {
    if (o.senal.aborted) return { motivo: 'cancelado', pasos, pendientes: hechos }
    throw e
  }
}
