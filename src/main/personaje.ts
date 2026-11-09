import { app, ipcMain, screen } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CANALES, type RecursosPersonaje } from '../shared/tipos'
import type { Config } from './entorno'
import type { VentanaOrbe } from './ventana'

/** Cada cuánto se mira dónde está el cursor (para que el personaje lo siga con los ojos). */
const INTERVALO_CURSOR_MS = 90
/** Un .riv razonable pesa unos KB o pocos MB. */
const RIVE_MAX_BYTES = 20 * 1024 * 1024

/** El motor de Rive (WebAssembly) va dentro de la aplicación: nunca se descarga de internet. */
function rutaWasmRive(): string {
  return join(app.getAppPath(), 'node_modules', '@rive-app', 'canvas', 'rive.wasm')
}

/**
 * La figura de la esquina: le dice a la interfaz cuál usar (y, si es de Rive, le pasa el archivo y el motor), y le va
 * diciendo dónde está el cursor mientras la ventana se ve, para que el personaje lo mire. Con el orbe clásico no
 * se mira el cursor.
 */
export function registrarPersonaje(opciones: { ventana: VentanaOrbe; config: Config }): void {
  const { ventana, config } = opciones
  const propia = (e: Electron.IpcMainInvokeEvent): boolean => e.sender === ventana.ventana.webContents

  ipcMain.handle(CANALES.personajeRecursos, async (e): Promise<RecursosPersonaje> => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    if (config.apariencia !== 'rive') return { apariencia: config.apariencia, diseno: config.diseno }
    try {
      const archivo = await readFile(config.rive.archivo)
      if (archivo.length > RIVE_MAX_BYTES) throw new Error('El archivo .riv pesa más de 20 MB.')
      const wasm = await readFile(rutaWasmRive())
      return { apariencia: 'rive', diseno: config.diseno, rive: { archivo: new Uint8Array(archivo), wasm: new Uint8Array(wasm), maquina: config.rive.maquina || null } }
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error)
      return { apariencia: 'personaje', diseno: config.diseno, aviso: `No he podido cargar el personaje de Rive (${motivo}). Uso el personaje de siempre.` }
    }
  })

  if (config.apariencia === 'orbe') return
  let ultimo = { x: Number.NaN, y: Number.NaN }
  const temporizador = setInterval(() => {
    const w = ventana.ventana
    if (w.isDestroyed() || !w.isVisible()) return
    const p = screen.getCursorScreenPoint()
    if (p.x === ultimo.x && p.y === ultimo.y) return
    ultimo = p
    w.webContents.send(CANALES.personajeCursor, { x: p.x, y: p.y })
  }, INTERVALO_CURSOR_MS)
  temporizador.unref?.()
  app.once('will-quit', () => clearInterval(temporizador))
}
