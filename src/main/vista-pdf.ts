import { existsSync, readFileSync } from 'node:fs'
import { basename, extname, resolve, sep } from 'node:path'
import { BrowserWindow, ipcMain, shell, type WebContents } from 'electron'
import { CANALES } from '../shared/tipos'

/** Una ruta de PDF que Orbe creó (dentro de sus carpetas permitidas), o null. Nada más del disco se enseña ni se abre. */
export function pdfPermitido(ruta: unknown, raices: string[]): string | null {
  if (typeof ruta !== 'string' || ruta.length > 500) return null
  const r = resolve(ruta)
  if (extname(r).toLowerCase() !== '.pdf' || !existsSync(r)) return null
  return raices.some((raiz) => r.startsWith(resolve(raiz) + sep)) ? r : null
}

/** Previsualizar los PDF de informes y de ECC: miniatura para el chat y abrirlos (visor de Orbe, app o carpeta). */
export function registrarVistaPdf(chat: () => WebContents, raices: string[]): void {
  ipcMain.handle(CANALES.pdfVista, (e, ruta: unknown) => {
    const r = e.sender === chat() ? pdfPermitido(ruta, raices) : null
    if (!r) return null
    const png = r.replace(/\.pdf$/i, '.png')
    return { nombre: basename(r), miniatura: existsSync(png) ? `data:image/png;base64,${readFileSync(png).toString('base64')}` : null }
  })
  ipcMain.handle(CANALES.pdfAbrir, async (e, ruta: unknown, modo: unknown) => {
    const r = e.sender === chat() ? pdfPermitido(ruta, raices) : null
    if (!r) return
    if (modo === 'carpeta') return shell.showItemInFolder(r)
    if (modo === 'abrir') return void (await shell.openPath(r))
    // «Ver»: el visor de PDF de Chromium en una ventana propia; los enlaces se abren en el navegador.
    const v = new BrowserWindow({ width: 860, height: 1000, title: basename(r), autoHideMenuBar: true, backgroundColor: '#0e1022', webPreferences: { plugins: true, sandbox: true } })
    v.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    v.webContents.on('will-navigate', (ev, url) => {
      ev.preventDefault()
      if (/^https:\/\//.test(url)) void shell.openExternal(url)
    })
    await v.loadFile(r)
  })
}
