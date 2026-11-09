import { app, ipcMain, screen } from 'electron'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CANALES, type CalibracionModelo, type RecursosPersonaje } from '../shared/tipos'
import type { Config } from './entorno'
import type { VentanaOrbe } from './ventana'
import { Vigia } from './vigia'

/** Cada cuánto se mira dónde está el cursor (para que el personaje lo siga con los ojos). */
const INTERVALO_CURSOR_MS = 90
/** Un .riv razonable pesa unos KB o pocos MB. */
const RIVE_MAX_BYTES = 20 * 1024 * 1024

/** El motor de Rive (WebAssembly) va dentro de la aplicación: nunca se descarga de internet. */
function rutaWasmRive(): string {
  return join(app.getAppPath(), 'node_modules', '@rive-app', 'canvas', 'rive.wasm')
}

/** Un modelo 3D razonable para la esquina pesa de cientos de KB a pocos MB. */
const MODELO_MAX_BYTES = 40 * 1024 * 1024

/** El conejo que trae Orbe (resources/personaje), dentro o fuera del instalador. */
export function rutaModeloIncluido(): string {
  return app.isPackaged ? join(process.resourcesPath, 'personaje', 'conejo.glb') : join(app.getAppPath(), 'resources', 'personaje', 'conejo.glb')
}

/** Lee el GLB y, si existe a su lado, su calibración (mismo nombre con .json). */
async function leerModelo3d(ruta: string): Promise<NonNullable<RecursosPersonaje['modelo3d']>> {
  const glb = await readFile(ruta)
  if (glb.length > MODELO_MAX_BYTES) throw new Error('El modelo 3D pesa más de 40 MB.')
  if (glb.subarray(0, 4).toString('latin1') !== 'glTF') throw new Error('No es un archivo .glb.')
  let calibracion: Partial<CalibracionModelo> | undefined
  try {
    const leida = JSON.parse(await readFile(ruta.replace(/\.glb$/i, '.json'), 'utf8')) as unknown
    if (leida && typeof leida === 'object') calibracion = leida as Partial<CalibracionModelo>
  } catch {
    // sin calibración: la de por defecto
  }
  // Texturas de detalle junto al modelo (pelo.jpg y tejido.jpg), si las hay.
  const carpeta = dirname(ruta)
  const leerOpcional = async (nombre: string): Promise<Uint8Array | undefined> => {
    try {
      const b = await readFile(join(carpeta, nombre))
      return b.length <= 8 * 1024 * 1024 ? new Uint8Array(b) : undefined
    } catch {
      return undefined
    }
  }
  const pelo = await leerOpcional('pelo.jpg')
  const tejido = await leerOpcional('tejido.jpg')
  const detalles = pelo || tejido ? { ...(pelo ? { pelo } : {}), ...(tejido ? { tejido } : {}) } : undefined
  return { glb: new Uint8Array(glb), ...(calibracion ? { calibracion } : {}), ...(detalles ? { detalles } : {}) }
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
    if (config.apariencia === '3d') {
      try {
        return { apariencia: '3d', diseno: config.diseno, modelo3d: await leerModelo3d(config.modelo3d || rutaModeloIncluido()) }
      } catch (error) {
        const motivo = error instanceof Error ? error.message : String(error)
        return { apariencia: 'personaje', diseno: config.diseno, aviso: `No he podido cargar el personaje 3D (${motivo}). Uso el personaje dibujado.` }
      }
    }
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

  // Lo que pasa en el equipo (te fuiste, volviste, bloqueaste…) para que el personaje reaccione.
  const vigia = new Vigia((evento) => {
    const w = ventana.ventana
    if (!w.isDestroyed()) w.webContents.send(CANALES.personajeEntorno, evento)
  })
  vigia.iniciar()
  app.once('will-quit', () => vigia.detener())
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
