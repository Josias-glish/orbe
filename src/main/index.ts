import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { liberarAtajos, registrarAtajos } from './atajos'
import { VentanaOrbe } from './ventana'

const modoHumo = process.argv.includes('--smoke')

// Instancia única: un segundo arranque no abre otro orbe.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let ventanaOrbe: VentanaOrbe | null = null

app.whenReady().then(() => {
  const urlDev = process.env['ELECTRON_RENDERER_URL'] ?? null
  ventanaOrbe = new VentanaOrbe(urlDev, join(__dirname, '../renderer/index.html'))

  registrarAtajos({ alternarPanel: () => ventanaOrbe?.alternar() })

  if (modoHumo) void pruebaDeHumo(ventanaOrbe)
})

app.on('second-instance', () => {
  ventanaOrbe?.mostrar()
})

// El orbe vive en segundo plano: cerrar la ventana no cierra la app (la bandeja llega en la fase 5).
app.on('window-all-closed', () => {})

app.on('will-quit', () => liberarAtajos())

/** Arranca, recorre los estados del orbe, guarda capturas del render y sale. */
async function pruebaDeHumo(orbe: VentanaOrbe): Promise<void> {
  const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const carpeta = join(process.cwd(), 'humo')
  mkdirSync(carpeta, { recursive: true })
  const wc = orbe.ventana.webContents
  const informe: Record<string, unknown> = {}

  try {
    await new Promise<void>((r) => (wc.isLoading() ? wc.once('did-finish-load', () => r()) : r()))
    await esperar(1200)
    informe.webgl = await wc.executeJavaScript('window.__orbeDiagnostico && window.__orbeDiagnostico()')

    const capturar = async (nombre: string): Promise<void> => {
      const imagen = await wc.capturePage()
      writeFileSync(join(carpeta, `${nombre}.png`), imagen.toPNG())
    }

    for (const estado of ['reposo', 'leyendo', 'pensando', 'respondiendo']) {
      await wc.executeJavaScript(`window.__orbeEstado && window.__orbeEstado(${JSON.stringify(estado)})`)
      await esperar(estado === 'leyendo' ? 500 : 900)
      await capturar(`1-${estado}`)
    }
    await wc.executeJavaScript(`window.__orbeEstado('reposo')`)

    orbe.establecerExpandido(true)
    await esperar(600)
    await capturar('2-expandido')
    informe.boundsExpandido = orbe.ventana.getBounds()

    orbe.establecerExpandido(false)
    await esperar(400)
    informe.boundsColapsado = orbe.ventana.getBounds()
    // En reposo estable el orbe debe quedarse en ~30 fps como máximo.
    await esperar(2600)
    informe.fpsReposo = await wc.executeJavaScript('window.__orbeDiagnostico().fps')
  } catch (error) {
    informe.error = String(error)
  }

  writeFileSync(join(carpeta, 'informe.json'), JSON.stringify(informe, null, 2))
  console.log('HUMO', JSON.stringify(informe))
  BrowserWindow.getAllWindows().forEach((w) => w.destroy())
  app.exit(informe.error ? 1 : 0)
}
