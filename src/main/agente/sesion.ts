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
  /**
   * La búsqueda web de la propia API de Claude (la ejecuta Anthropic, no nosotros): solo existe con el proveedor
   * `api`. `maxUsos` es el máximo de búsquedas por petición.
   */
  busquedaNativa?: { maxUsos: number }
  /**
   * La búsqueda web que trae el propio CLI de Claude (la ejecuta con tu sesión, sin clave): solo existe con el proveedor
   * `cli`. Orbe no puede limitar cuántas hace; solo encenderla o apagarla.
   */
  busquedaCli?: boolean
}

export const PASOS_POR_DEFECTO = 15

/** El agente solo se ofrece si hay algo que ofrecer: sin herramientas el chat sigue exactamente como antes. */
export function agenteActivo(agente: OpcionesAgente | undefined): agente is OpcionesAgente {
  return agente !== undefined && (!agente.registro.vacio || agente.busquedaNativa !== undefined || agente.busquedaCli === true)
}

/** ¿Puede buscar en internet, con la búsqueda de la API de Claude, la del CLI o la herramienta `buscar_web`? */
export function hayBusquedaWeb(agente: OpcionesAgente): boolean {
  return agente.busquedaNativa !== undefined || agente.busquedaCli === true || agente.registro.buscar(NOMBRE_BUSCAR_WEB) !== undefined
}

/** Cómo se llama la herramienta propia de búsqueda (con la API de Claude la búsqueda es la nativa, `web_search`). */
export const NOMBRE_BUSCAR_WEB = 'buscar_web'

/** Prepara el ejecutor de una tarea: política y marca de contenido externo nuevas, atadas a los manejadores del turno. */
export function crearEjecutor(agente: OpcionesAgente, senal: AbortSignal, m: ManejadoresTurno): EjecutorHerramientas {
  return new EjecutorHerramientas({
    registro: agente.registro,
    politica: new Politica(),
    senal,
    alAccion: (accion) => m.alAccion?.(accion),
    alFuentes: (fuentes) => m.alFuentes?.(fuentes),
    confirmar: m.confirmar,
    nonce: crearNonce(),
    permitirLocal: agente.permitirLocal
  })
}
