import { globalShortcut } from 'electron'
import { ATAJO_LEER_POR_DEFECTO, ATAJO_PANEL_POR_DEFECTO } from './entorno'

export interface AccionesAtajos {
  alternarPanel: () => void
  leerPantalla: () => void
}

export interface ConfigAtajos {
  panel: string
  leer: string
}

export const ATAJOS_POR_DEFECTO: ConfigAtajos = { panel: ATAJO_PANEL_POR_DEFECTO, leer: ATAJO_LEER_POR_DEFECTO }

export interface ResultadoAtajos {
  registrados: string[]
  /** Atajos que Windows no dejó registrar (los usa otra aplicación) o que no son válidos. */
  fallidos: string[]
}

/** Registra los atajos globales. Un atajo ocupado no impide que funcione el otro. */
export function registrarAtajos(acciones: AccionesAtajos, config: ConfigAtajos = ATAJOS_POR_DEFECTO): ResultadoAtajos {
  const resultado: ResultadoAtajos = { registrados: [], fallidos: [] }
  const intentar = (acelerador: string, accion: () => void): void => {
    try {
      if (globalShortcut.register(acelerador, accion)) resultado.registrados.push(acelerador)
      else resultado.fallidos.push(acelerador)
    } catch {
      resultado.fallidos.push(acelerador) // acelerador mal escrito
    }
  }
  intentar(config.panel, acciones.alternarPanel)
  if (config.leer !== config.panel) intentar(config.leer, acciones.leerPantalla)
  else resultado.fallidos.push(config.leer)

  for (const f of resultado.fallidos) {
    console.warn(`[orbe] No se pudo registrar el atajo ${f}: lo usa otra aplicación o no es válido.`)
  }
  return resultado
}

export function liberarAtajos(): void {
  globalShortcut.unregisterAll()
}
