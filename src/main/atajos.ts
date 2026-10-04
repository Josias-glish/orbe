import { globalShortcut } from 'electron'

export interface AccionesAtajos {
  alternarPanel: () => void
}

export const ATAJO_ALTERNAR = 'CommandOrControl+Shift+Space'

/** Registra los atajos globales. Devuelve false si el sistema no deja registrar alguno. */
export function registrarAtajos(acciones: AccionesAtajos): boolean {
  const ok = globalShortcut.register(ATAJO_ALTERNAR, acciones.alternarPanel)
  if (!ok) console.warn(`No se pudo registrar el atajo ${ATAJO_ALTERNAR}: lo usa otra aplicación.`)
  return ok
}

export function liberarAtajos(): void {
  globalShortcut.unregisterAll()
}
