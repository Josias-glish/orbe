import { BrowserWindow, clipboard, ipcMain, nativeImage, session, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { CUENTAS } from '../conectores/instagram/cliente'
import { CANALES, type CambiosPieza, type EstadoContenido } from '../../shared/tipos'
import { limpiarCambios, type AlmacenContenido } from './almacen'

const URL_CLAUDE_DESIGN = 'https://claude.ai/design'

/**
 * HTML → PNG de 1080×1350 en una ventana oculta, con sesión propia, sin JavaScript y sin red: solo puede cargar
 * `data:` y archivos de la carpeta de la marca (fuentes, logotipo). Es el respaldo si un diseño llega en HTML.
 */
export async function renderizarPng(html: string, carpetaMarca: string): Promise<Buffer> {
  const ses = session.fromPartition('orbe-render')
  const permitido = pathToFileURL(carpetaMarca).href
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !(d.url.startsWith('data:') || d.url.startsWith(permitido)) }))
  const ventana = new BrowserWindow({
    show: false,
    width: 1080,
    height: 1350,
    useContentSize: true,
    webPreferences: { session: ses, javascript: false, sandbox: true, offscreen: true, contextIsolation: true }
  })
  try {
    await ventana.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html), { baseURLForDataURL: permitido + '/' })
    await new Promise((r) => setTimeout(r, 300)) // ponytail: espera fija a las fuentes; document.fonts.ready si alguna llega tarde
    const imagen = await ventana.webContents.capturePage({ x: 0, y: 0, width: 1080, height: 1350 })
    return imagen.resize({ width: 1080, height: 1350 }).toPNG()
  } finally {
    ventana.destroy()
  }
}

/** Conecta el almacén de contenido con la pestaña «Contenido». */
export function registrarContenido(ventana: BrowserWindow, almacen: AlmacenContenido): void {
  const propia = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean => e.sender === ventana.webContents
  const estado = (): EstadoContenido => ({
    piezas: almacen.lista().map((p) => ({
      ...p,
      miniaturas: p.archivos.map((a) => nativeImage.createFromPath(almacen.rutaArchivo(p, a)).resize({ width: 216 }).toDataURL())
    })),
    avisos: almacen.avisos
  })
  const manejar = <A extends unknown[]>(canal: string, hacer: (...args: A) => unknown): void => {
    ipcMain.handle(canal, async (e, ...args) => {
      if (!propia(e)) throw new Error('Remitente no autorizado')
      await hacer(...(args as A))
      return estado()
    })
  }
  manejar(CANALES.contenidoEstado, () => almacen.recoger())
  manejar(CANALES.contenidoActualizar, (id: string, c: CambiosPieza) => almacen.actualizar(String(id), limpiarCambios(c)))
  manejar(CANALES.contenidoAprobar, (id: string, si: boolean) => almacen.aprobar(String(id), si === true))
  manejar(CANALES.contenidoBorrar, (id: string) => almacen.borrar(String(id)))
  ipcMain.handle(CANALES.contenidoDisenar, async (e, id: string) => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    clipboard.writeText(almacen.encargo(String(id)))
    await shell.openExternal(URL_CLAUDE_DESIGN)
  })
  ipcMain.on(CANALES.contenidoCarpeta, (e, marca: string) => {
    if (!propia(e) || !(CUENTAS as readonly string[]).includes(marca)) return
    void shell.openPath(almacen.entrada(marca as (typeof CUENTAS)[number]))
  })
}
