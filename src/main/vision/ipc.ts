import { ipcMain, type WebContents } from 'electron'
import { CANALES } from '../../shared/tipos'
import type { ResultadoOjos } from '../../shared/vision'
import type { VentanaUia } from '../pantalla/contexto'
import { capturarVentana } from './ojos'
import type { ServicioVision } from './servicio'

/**
 * Ajustes → Visión: ver el estado, dar el permiso (una sola vez) y probar los ojos con la ventana que el usuario
 * estaba usando. La imagen no sale de esta función: solo vuelve la descripción.
 */
export function registrarVision(chat: () => WebContents, vision: ServicioVision, ventanaObjetivo: () => Promise<VentanaUia | null>): void {
  const propia = (e: Electron.IpcMainInvokeEvent): boolean => e.sender === chat()
  ipcMain.handle(CANALES.visionEstado, (e) => (propia(e) ? vision.estado() : null))
  ipcMain.handle(CANALES.visionConsentir, (e) => (propia(e) ? vision.consentir() : null))
  ipcMain.handle(CANALES.visionProbar, async (e): Promise<ResultadoOjos | null> => {
    if (!propia(e)) return null
    try {
      const v = await ventanaObjetivo()
      if (!v) throw new Error('No sé qué ventana estabas usando: abre otra app y vuelve a probar.')
      const jpeg = await capturarVentana(v)
      if (!jpeg) throw new Error(`No miro «${v.aplicacion || v.proceso}»: es privada o salió en negro.`)
      const descripcion = await vision.describirPantalla(jpeg)
      return { ok: true, descripcion, ventana: v.aplicacion || v.proceso, estado: vision.estado() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), estado: vision.estado() }
    }
  })
}
