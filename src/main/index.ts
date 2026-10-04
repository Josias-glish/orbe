import { app } from 'electron'
import { dirname, join } from 'node:path'
import { liberarAtajos, registrarAtajos } from './atajos'
import { crearProveedor, infoChat } from './chat/fabrica'
import { registrarChat } from './chat/ipc'
import { ProveedorDemo } from './chat/proveedor-demo'
import type { ServicioChat } from './chat/servicio'
import { leerArchivosEnv, resolverConfig } from './entorno'
import { ejecutarHumo } from './humo'
import { VentanaOrbe } from './ventana'

const modoHumo = process.argv.includes('--smoke')
// Con --real, la prueba de humo habla con Claude de verdad (gasta unos céntimos de tu plan).
const humoReal = modoHumo && process.argv.includes('--real')

// La prueba de humo no debe tocar los ajustes reales del usuario.
if (modoHumo) app.setPath('userData', join(app.getPath('temp'), 'orbe-humo'))

// Instancia única: un segundo arranque no abre otro orbe.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let ventanaOrbe: VentanaOrbe | null = null
let servicioChat: ServicioChat | null = null

/** Dónde buscar el .env: junto al proyecto en desarrollo, junto al .exe al instalar, y en los datos del usuario. */
function rutasEnv(): string[] {
  const rutas = app.isPackaged ? [join(dirname(process.execPath), '.env')] : [join(app.getAppPath(), '.env')]
  rutas.push(join(app.getPath('userData'), '.env'))
  return rutas
}

app.whenReady().then(() => {
  const lectura = leerArchivosEnv(rutasEnv())
  const config = resolverConfig(lectura.valores)
  for (const aviso of config.avisos) console.warn('[orbe]', aviso)

  const urlDev = process.env['ELECTRON_RENDERER_URL'] ?? null
  ventanaOrbe = new VentanaOrbe(urlDev, join(__dirname, '../renderer/index.html'))

  const proveedor = modoHumo && !humoReal ? new ProveedorDemo() : crearProveedor(config, app.getPath('userData'))
  const info = modoHumo && !humoReal ? { proveedor: 'cli' as const, modelo: 'demo', modeloLegible: 'Demo' } : infoChat(config)
  servicioChat = registrarChat(ventanaOrbe.ventana, proveedor, info)

  registrarAtajos({ alternarPanel: () => ventanaOrbe?.alternar() })

  if (modoHumo) void ejecutarHumo(ventanaOrbe, humoReal)
})

app.on('second-instance', () => {
  ventanaOrbe?.mostrar()
})

// El orbe vive en segundo plano: cerrar la ventana no cierra la app (la bandeja llega en la fase 5).
app.on('window-all-closed', () => {})

app.on('will-quit', () => {
  liberarAtajos()
  servicioChat?.cerrar()
})
