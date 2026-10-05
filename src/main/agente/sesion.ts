import type { ManejadoresTurno } from '../chat/proveedor'
import { crearNonce } from './envoltorio'
import { EjecutorHerramientas } from './ejecutor'
import { Politica } from './politica'
import type { RegistroHerramientas } from './registro'

/** Lo que un proveedor necesita para funcionar como agente. */
export interface OpcionesAgente {
  registro: RegistroHerramientas
  /** Máximo de rondas de herramientas por tarea. */
  maxPasos: number
  /** El usuario permitió llegar a localhost y redes privadas. */
  permitirLocal: boolean
}

export const PASOS_POR_DEFECTO = 15

/** El agente solo se ofrece si hay algo que ofrecer: sin herramientas el chat sigue exactamente como antes. */
export function agenteActivo(agente: OpcionesAgente | undefined): agente is OpcionesAgente {
  return agente !== undefined && !agente.registro.vacio
}

/** Prepara el ejecutor de una tarea: política y marca de contenido externo nuevas, atadas a los manejadores del turno. */
export function crearEjecutor(agente: OpcionesAgente, senal: AbortSignal, m: ManejadoresTurno): EjecutorHerramientas {
  return new EjecutorHerramientas({
    registro: agente.registro,
    politica: new Politica(),
    senal,
    alAccion: (accion) => m.alAccion?.(accion),
    confirmar: m.confirmar,
    nonce: crearNonce(),
    permitirLocal: agente.permitirLocal
  })
}
