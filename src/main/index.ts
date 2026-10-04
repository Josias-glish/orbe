import { app } from 'electron'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { liberarAtajos, registrarAtajos } from './atajos'
import { crearProveedor, infoChat } from './chat/fabrica'
import { registrarChat } from './chat/ipc'
import { ProveedorDemo } from './chat/proveedor-demo'
import type { ServicioChat } from './chat/servicio'
import { leerArchivosEnv, resolverConfig } from './entorno'
import { ServicioFondos } from './fondos'
import { procesarConElectron } from './fondos-electron'
import { prepararFondosDeMentira, procesarDeMentira } from './fondos-demo'
import { registrarFondos } from './fondos-ipc'
import { ejecutarHumo } from './humo'
import { prepararMemoriaDeMentira } from './memoria/fuente-demo'
import { registrarMemoria } from './memoria/ipc'
import { ServicioMemoria } from './memoria/servicio'
import { ServicioCaptura } from './pantalla/captura'
import { CapturaDemo } from './pantalla/captura-demo'
import { crearDepsReales } from './pantalla/captura-electron'
import { FuenteHelper, type FuenteUia } from './pantalla/contexto'
import { FuenteDemo } from './pantalla/fuente-demo'
import { ClienteHelper } from './pantalla/helper-uia'
import { registrarPantalla } from './pantalla/ipc'
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
let helper: ClienteHelper | null = null

/** Dónde buscar el .env: junto al proyecto en desarrollo, junto al .exe al instalar, y en los datos del usuario. */
function rutasEnv(): string[] {
  const rutas = app.isPackaged ? [join(dirname(process.execPath), '.env')] : [join(app.getAppPath(), '.env')]
  rutas.push(join(app.getPath('userData'), '.env'))
  return rutas
}

/** Carpeta del lector de pantalla (PowerShell + C#): fuera del asar al empaquetar. */
function carpetaHelper(): string {
  return app.isPackaged ? join(process.resourcesPath, 'helper') : join(app.getAppPath(), 'helper')
}

app.whenReady().then(() => {
  const lectura = leerArchivosEnv(rutasEnv())
  const config = resolverConfig(lectura.valores)
  for (const aviso of config.avisos) console.warn('[orbe]', aviso)

  const urlDev = process.env['ELECTRON_RENDERER_URL'] ?? null
  ventanaOrbe = new VentanaOrbe(urlDev, join(__dirname, '../renderer/index.html'))
  const orbe = ventanaOrbe

  // Lector de pantalla: arranca ya (compilar el helper la primera vez tarda ~1 s) pero no lee nada hasta que se le pide.
  // La prueba de humo usa una fuente de mentira: nunca toca la pantalla real del usuario.
  const fuenteDemo = modoHumo ? new FuenteDemo() : null
  let fuente: FuenteUia
  if (fuenteDemo) {
    fuente = fuenteDemo
  } else {
    helper = new ClienteHelper({
      pidOrbe: process.pid,
      carpetaHelper: carpetaHelper(),
      cacheDir: join(app.getPath('userData'), 'uia-cache')
    })
    helper.precalentar()
    fuente = new FuenteHelper(helper)
  }
  // Captura de respaldo: en la prueba de humo es de mentira (ni fotografía la pantalla real ni oculta la ventana).
  const capturaDemo = modoHumo ? new CapturaDemo() : null
  const captura = new ServicioCaptura(capturaDemo ?? crearDepsReales(orbe, () => fuente.ventana()))
  const pantalla = registrarPantalla({
    ventana: orbe,
    fuente,
    contextoMax: config.contextoMax,
    captura
  })

  // Memoria: los recuerdos del usuario (propios o traídos de la memoria de Claude) y su conversación guardada.
  // La prueba de humo empieza siempre de cero y con notas de mentira: nunca lee ni enseña la memoria real.
  const datos = app.getPath('userData')
  if (modoHumo) {
    rmSync(join(datos, 'memoria'), { recursive: true, force: true })
    rmSync(join(datos, 'conversacion.json'), { force: true })
    rmSync(join(datos, 'fondo.json'), { force: true })
    rmSync(join(datos, 'fondos-cache'), { recursive: true, force: true })
    rmSync(join(datos, 'ajustes.json'), { force: true })
  }
  const memoria = new ServicioMemoria({
    carpeta: join(datos, 'memoria'),
    archivoConversacion: join(datos, 'conversacion.json'),
    max: config.memoriaMax,
    origenesClaude: modoHumo ? prepararMemoriaDeMentira(app.getPath('temp')) : config.memoriaOrigenes
  })
  memoria.iniciar()
  registrarMemoria(orbe.ventana, memoria)

  // Fondos del chat: imágenes de la carpeta que indique ORBE_FONDOS (en la prueba de humo, de mentira).
  const fondos = new ServicioFondos({
    carpeta: modoHumo ? prepararFondosDeMentira(app.getPath('temp')) : config.fondosCarpeta || null,
    archivoEstado: join(datos, 'fondo.json'),
    carpetaCache: join(datos, 'fondos-cache'),
    procesar: modoHumo ? procesarDeMentira : procesarConElectron
  })
  registrarFondos(orbe.ventana, fondos)

  const proveedor =
    modoHumo && !humoReal ? new ProveedorDemo() : crearProveedor(config, datos, () => memoria.bloquePrompt())
  const info = modoHumo && !humoReal ? { proveedor: 'cli' as const, modelo: 'demo', modeloLegible: 'Demo' } : infoChat(config)
  servicioChat = registrarChat(
    orbe.ventana,
    proveedor,
    info,
    {
      consumir: () => pantalla.pendiente.consumir(),
      restaurar: (c) => pantalla.pendiente.restaurar(c),
      emitir: pantalla.emitir
    },
    memoria
  )

  registrarAtajos(
    { alternarPanel: () => orbe.alternar(), leerPantalla: () => void pantalla.leerConAtajo() },
    { panel: config.atajoPanel, leer: config.atajoLeer }
  )

  if (fuenteDemo && capturaDemo) {
    void ejecutarHumo(orbe, humoReal, { fuente: fuenteDemo, leerConAtajo: pantalla.leerConAtajo, memoria, captura: capturaDemo })
  }
})

app.on('second-instance', () => {
  ventanaOrbe?.mostrar()
})

// El orbe vive en segundo plano: cerrar la ventana no cierra la app (la bandeja llega en la fase 5).
app.on('window-all-closed', () => {})

app.on('will-quit', () => {
  liberarAtajos()
  servicioChat?.cerrar()
  helper?.cerrar()
})
