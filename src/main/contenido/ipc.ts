import { BrowserWindow, clipboard, ipcMain, nativeImage, session, shell } from 'electron'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CUENTAS } from '../conectores/instagram/cliente'
import { CANALES, type CambiosPieza, type EstadoContenido } from '../../shared/tipos'
import { limpiarCambios, type AlmacenContenido } from './almacen'
import type { Disenador } from './disenador'

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
    webPreferences: { session: ses, javascript: false, sandbox: true, contextIsolation: true }
  })
  try {
    // Medidas exactas sin depender del escalado de Windows (al 150 % una ventana de 1080 px solo tiene 720 de diseño).
    const cdp = ventana.webContents.debugger
    cdp.attach('1.3')
    await cdp.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1350, deviceScaleFactor: 1, mobile: false })
    await cdp.sendCommand('Emulation.setScrollbarsHidden', { hidden: true })
    // Se carga desde un archivo de la carpeta de la marca (una data: URL con una foto dentro pasaría el límite de 2 MB).
    const archivo = join(carpetaMarca, `.render-${process.hrtime.bigint()}.html`)
    writeFileSync(archivo, html)
    try {
      await ventana.loadURL(pathToFileURL(archivo).href)
    } finally {
      rmSync(archivo, { force: true })
    }
    await new Promise((r) => setTimeout(r, 300)) // ponytail: espera fija a las fuentes; document.fonts.ready si alguna llega tarde
    const { data } = (await cdp.sendCommand('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: 1080, height: 1350, scale: 1 }
    })) as { data: string }
    return Buffer.from(data, 'base64')
  } finally {
    ventana.destroy()
  }
}

/** Conecta el almacén de contenido con la pestaña «Contenido». */
export function registrarContenido(ventana: BrowserWindow, almacen: AlmacenContenido, disenador: Disenador): void {
  const propia = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean => e.sender === ventana.webContents
  const estado = (): EstadoContenido => ({
    piezas: almacen.lista().map((p) => ({
      ...p,
      miniaturas: p.archivos.map((a) => nativeImage.createFromPath(almacen.rutaArchivo(p, a)).resize({ width: 216 }).toDataURL()),
      disenando: disenador.enCurso.has(p.id),
      errorDiseno: disenador.errores.get(p.id)
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
  // Diseñar no se espera: tarda un minuto o dos y la pestaña se entera por `contenidoCambio`.
  manejar(CANALES.contenidoDisenar, (id: string) => void disenador.disenar(String(id)).catch(() => undefined))
  ipcMain.handle(CANALES.contenidoClaudeDesign, async (e, id: string) => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    clipboard.writeText(almacen.encargo(String(id)))
    await shell.openExternal(URL_CLAUDE_DESIGN)
  })
  ipcMain.on(CANALES.contenidoCarpeta, (e, marca: string) => {
    if (!propia(e) || !(CUENTAS as readonly string[]).includes(marca)) return
    void shell.openPath(almacen.entrada(marca as (typeof CUENTAS)[number]))
  })
}
