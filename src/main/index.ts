import { perfilDe } from '../shared/identidad'
import { app, Notification, type Tray } from 'electron'
import { crearBandeja } from './bandeja'
import { registrarConfiguracion } from './configuracion'
import { registrarConectores } from './conectores'
import { registrarCofre } from './cofre/electron'
import { asegurarReglas } from './agente/reglas'
import { registrarPersonaje } from './personaje'
import { CANALES } from '../shared/tipos'
import { existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { crearRegistro } from './agente/herramientas'
import { crearHerramientasGmail } from './agente/herramientas/gmail'
import { crearHerramientasInstagram } from './agente/herramientas/instagram'
import { ServicioMetricas, dia } from './metricas/servicio'
import { programarFotoDiaria, registrarMetricas } from './metricas/ipc'
import { instagramDemo } from './metricas/demo'
import { crearHerramientaCrecimiento } from './agente/herramientas/metricas'
import { Gmail } from './conectores/gmail/cliente'
import { crearFuenteTokenIg, Instagram, type TokenGuardado } from './conectores/instagram/cliente'
import { crearFuenteDeToken, leerClienteGoogle } from './conectores/gmail/oauth'
import { crearDepsSistema } from './agente/sistema'
import { guardarAjustes, leerAjustes } from './ajustes'
import { liberarAtajos, registrarAtajos } from './atajos'
import { crearProveedor, infoChat } from './chat/fabrica'
import { registrarChat } from './chat/ipc'
import { RegistroUso } from './uso/registro'
import { ServicioTareas } from './tareas/servicio'
import { registrarTareas } from './tareas/ipc'
import { registrarUso } from './uso/ipc'
import { ProveedorDemo } from './chat/proveedor-demo'
import type { ServicioChat } from './chat/servicio'
import { leerArchivosEnv, resolverConfig } from './entorno'
import { ServicioFondos, carpetaTieneImagenes, elegirCarpetaFondos } from './fondos'
import { procesarConElectron } from './fondos-electron'
import { prepararFondosDeMentira, procesarDeMentira } from './fondos-demo'
import { registrarFondos } from './fondos-ipc'
import { ejecutarHumo } from './humo'
import { nivelInicial, registrarPotencia } from './potencia'
import { restringirPermisos } from './permisos'
import { ServicioDictado, ServicioSintesis, registrarVoz } from './voz'
import { wavSilencioso } from './voz-demo'
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
import { ServicioTextoImagen } from './pantalla/ocr'
import { OcrDemo } from './pantalla/ocr-demo'
import { cargarImagenElectron, crearDepsOcrReales } from './pantalla/ocr-electron'
import { ServicioFormula } from './pantalla/formula'
import { VentanaOrbe } from './ventana'

const modoHumo = process.argv.includes('--smoke')
// Con --real, la prueba de humo habla con Claude de verdad (gasta unos céntimos de tu plan).
const humoReal = modoHumo && process.argv.includes('--real')

// En la prueba de humo el micrófono es uno falso de Chromium (un pitido) y no se pide permiso a nadie.
if (modoHumo) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
}

// La prueba de humo no debe tocar los ajustes reales del usuario.
if (modoHumo) {
  app.setPath('userData', join(app.getPath('temp'), 'orbe-humo'))
  // Siempre desde cero (también las preferencias del navegador, como la voz), y antes de crear la ventana, que lee de
  // aquí su posición y su tamaño. Es una carpeta temporal solo de la prueba.
  rmSync(app.getPath('userData'), { recursive: true, force: true })
}

// Instancia única: un segundo arranque no abre otro orbe.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let ventanaOrbe: VentanaOrbe | null = null
let servicioChat: ServicioChat | null = null
let helper: ClienteHelper | null = null
let bandeja: Tray | null = null

/** Dónde buscar el .env: junto al proyecto en desarrollo, junto al .exe al instalar, y en los datos del usuario. */
function rutasEnv(): string[] {
  // En la versión portable, «junto al .exe» es junto al portable original, no la carpeta temporal donde se descomprime.
  const carpetaExe = process.env['PORTABLE_EXECUTABLE_DIR'] || dirname(process.execPath)
  const rutas = app.isPackaged ? [join(carpetaExe, '.env')] : [join(app.getAppPath(), '.env')]
  rutas.push(join(app.getPath('userData'), '.env'))
  return rutas
}

/** Carpeta del lector de pantalla (PowerShell + C#): fuera del asar al empaquetar. */
function carpetaHelper(): string {
  return app.isPackaged ? join(process.resourcesPath, 'helper') : join(app.getAppPath(), 'helper')
}

app.whenReady().then(async () => {
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
  // Texto de imagen (OCR de Windows, en el equipo): en la prueba de humo, de mentira (ni lee nada real ni lanza PowerShell).
  const ocrDemo = modoHumo ? new OcrDemo() : null
  const depsOcr = ocrDemo ?? crearDepsOcrReales({ ventana: orbe, ventanaObjetivo: () => fuente.ventana(), carpetaHelper: carpetaHelper() })
  const textoImagen = new ServicioTextoImagen(depsOcr, { contextoMax: config.contextoMax })
  // Fórmulas y química: la misma forma de conseguir la imagen; en la prueba de humo, una imagen de mentira.
  const formula = new ServicioFormula({
    obtener: (origen) => depsOcr.obtener(origen),
    cargar: ocrDemo ? () => ocrDemo.cargar() : cargarImagenElectron
  })
  const pantalla = registrarPantalla({
    ventana: orbe,
    fuente,
    contextoMax: config.contextoMax,
    captura,
    textoImagen,
    formula
  })

  // Memoria: los recuerdos del usuario (propios o traídos de la memoria de Claude) y su conversación guardada.
  // La prueba de humo empieza siempre de cero y con notas de mentira: nunca lee ni enseña la memoria real.
  const datos = app.getPath('userData')

  // La figura de la esquina (personaje, orbe o Rive) y los avisos de otras herramientas (Claude Code, scripts…).
  // La prueba de humo usa siempre el personaje dibujado y nunca abre el receptor de avisos.
  const configFigura = modoHumo ? resolverConfig({}, {}) : config
  registrarPersonaje({ ventana: orbe, config: configFigura })
  const actividad = await registrarConectores({ ventana: orbe, config: configFigura, carpetaDatos: datos, modoHumo })

  // Seguridad (Etapa 0): el cofre cifrado de los conectores y las reglas de permisos. En la prueba de humo, `datos` es
  // la carpeta temporal de la prueba: nunca toca el cofre ni las reglas reales.
  const rutaClienteGoogle = join(datos, 'google-cliente.json')
  const cofre = registrarCofre(orbe.ventana, join(datos, 'cofre.bin'), rutaClienteGoogle)
  actividad.filtrarCon((texto) => cofre.tachar(texto))
  try {
    if (asegurarReglas(join(datos, 'reglas.json'))) console.warn('[orbe] He creado reglas.json con las reglas por defecto.')
  } catch {
    console.warn('[orbe] No he podido crear reglas.json: valen las reglas por defecto.')
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
    carpeta: modoHumo
      ? prepararFondosDeMentira(app.getPath('temp'))
      : elegirCarpetaFondos(
          config.fondosCarpeta,
          app.isPackaged ? join(process.resourcesPath, 'fondos') : join(app.getAppPath(), 'resources', 'fondos'),
          carpetaTieneImagenes
        ),
    carpetaPropia: join(datos, 'fondos'),
    archivoEstado: join(datos, 'fondo.json'),
    carpetaCache: join(datos, 'fondos-cache'),
    procesar: modoHumo ? procesarDeMentira : procesarConElectron
  })
  registrarFondos(orbe.ventana, fondos)

  // Dictado por micrófono: el audio solo sale al terminar de grabar, hacia el servicio de transcripción configurado
  // (en la prueba de humo, una respuesta de mentira).
  restringirPermisos(orbe.ventana.webContents)
  const dictado = new ServicioDictado(
    modoHumo
      ? {
          ...resolverConfig({}, {}).dictado,
          disponible: true,
          clave: 'de-mentira',
          fetch: async () => new Response(JSON.stringify({ text: 'Texto dictado de prueba' }), { headers: { 'content-type': 'application/json' } })
        }
      : config.dictado
  )
  const sintesis = new ServicioSintesis(
    modoHumo
      ? {
          ...resolverConfig({}, {}).voz,
          disponible: true,
          clave: 'de-mentira',
          fetch: async () => new Response(wavSilencioso(300), { headers: { 'content-type': 'audio/wav' } })
        }
      : config.voz
  )
  registrarVoz(orbe.ventana, dictado, sintesis)

  // Pantalla de configuración: cambia el .env (proveedor, claves, dictado y voz) y reinicia Orbe. En la prueba de humo
  // escribe solo en la carpeta temporal y no reinicia.
  registrarConfiguracion({
    ventana: orbe.ventana,
    // La prueba de humo parte de una configuración vacía: nunca enseña ni toca la real.
    config: modoHumo ? resolverConfig({}, {}) : config,
    valores: modoHumo ? {} : lectura.valores,
    archivoEnv: modoHumo ? join(datos, '.env') : (lectura.usados[0] ?? join(datos, '.env')),
    reiniciar: () => {
      if (modoHumo) return
      // La portable se relanza desde su .exe original: la carpeta temporal donde se descomprime se borra al salir.
      const portable = process.env['PORTABLE_EXECUTABLE_FILE']
      app.relaunch(portable ? { execPath: portable, args: [] } : undefined)
      app.exit(0)
    },
    salir: () => {
      if (!modoHumo) app.quit()
    }
  })

  // Las herramientas del agente (según la configuración). Sin herramientas, el chat solo conversa.
  const sistema = crearDepsSistema(datos)
  // Gmail se ofrece si existe google-cliente.json (guía de Google); sin conectar, las herramientas dicen cómo conectarlo.
  const gmail = existsSync(rutaClienteGoogle)
    ? crearHerramientasGmail(new Gmail(crearFuenteDeToken(() => leerClienteGoogle(rutaClienteGoogle), () => cofre.leer('gmail.refresh'))))
    : []
  // Instagram (solo lectura) se ofrece siempre: sin token guardado, cada herramienta dice dónde guardarlo, y así
  // guardar uno en Ajustes vale sin reiniciar.
  const tokenIg = crearFuenteTokenIg((clave) => cofre.leer<TokenGuardado>(clave), (clave, valor) => cofre.guardar(clave, valor))
  const instagram = crearHerramientasInstagram((cuenta) => new Instagram(() => tokenIg(cuenta), fetch, cuenta))
  // Métricas: perfil y publicaciones con sus cifras, comparadas con la media, más un historial diario en metricas.json.
  const metricas = new ServicioMetricas(
    modoHumo ? null : join(datos, 'metricas.json'),
    modoHumo && !humoReal ? () => instagramDemo() : (cuenta) => new Instagram(() => tokenIg(cuenta), fetch, cuenta)
  )
  registrarMetricas(orbe.ventana, metricas)
  if (!modoHumo) {
    const pararFotos = programarFotoDiaria(metricas, (c) => cofre.leer(`ig.${c}`) !== undefined, () => dia(new Date()))
    app.once('will-quit', pararFotos)
  }
  const registro = crearRegistro(config, sistema, [...gmail, ...instagram, crearHerramientaCrecimiento(metricas)])
  // Leer el menú Inicio tarda unos segundos (PowerShell): se adelanta cuando Orbe ya arrancó, para que «abre Spotify» sea inmediato.
  if (!modoHumo && config.agente.activo && config.proveedor !== 'cli') {
    setTimeout(() => void sistema.catalogo.cargar().catch(() => {}), 20_000).unref()
  }
  const proveedor =
    modoHumo && !humoReal ? new ProveedorDemo() : crearProveedor(config, datos, () => memoria.bloquePrompt(), registro)
  const info =
    modoHumo && !humoReal
      ? { proveedor: 'cli' as const, modelo: 'demo', modeloLegible: 'Demo', agente: true, identidad: config.identidad }
      : infoChat(config, registro)
  // El marcador de potencia de la cabecera: sube o baja cuánto «piensa» el modelo y recuerda el nivel entre sesiones.
  registrarPotencia({
    ventana: orbe.ventana,
    proveedor,
    nivel: nivelInicial(leerAjustes().esfuerzo, config.esfuerzo),
    guardar: (nivel) => guardarAjustes({ esfuerzo: nivel })
  })
  // Consumo: tokens y dólares de cada respuesta, por día y por modelo (la prueba de humo no toca el archivo real).
  const registroUso = new RegistroUso(modoHumo ? null : join(datos, 'uso.json'))
  app.once('will-quit', () => registroUso.guardarAhora())
  const contadorUso = registrarUso(orbe.ventana, registroUso, () => ({ nombre: proveedor.nombre, modelo: proveedor.modelo }))
  // Tareas de fondo (como los agentes «siempre encendidos»): instrucciones que Orbe hace solo cuando toca, cada una
  // en una conversación limpia con el mismo modelo, la memoria y las herramientas del agente.
  const tareas = new ServicioTareas({
    archivo: modoHumo ? null : join(datos, 'tareas.json'),
    crearProveedor: () =>
      modoHumo && !humoReal ? new ProveedorDemo() : crearProveedor(config, datos, () => memoria.bloquePrompt(), registro),
    bus: actividad,
    contador: contadorUso,
    identidad: perfilDe(config.identidad),
    notificar: (titulo, cuerpo) => {
      if (modoHumo || !Notification.isSupported()) return
      const aviso = new Notification({ title: titulo, body: cuerpo, silent: false })
      aviso.on('click', () => {
        orbe.mostrar()
        orbe.establecerExpandido(true)
      })
      aviso.show()
    },
    alCambio: () => {
      if (!orbe.ventana.isDestroyed()) orbe.ventana.webContents.send(CANALES.tareasCambio)
    }
  })
  registrarTareas(orbe.ventana, tareas)
  tareas.iniciar()
  app.once('will-quit', () => tareas.detener())
  servicioChat = registrarChat(
    orbe.ventana,
    proveedor,
    info,
    {
      consumir: () => pantalla.pendiente.consumir(),
      restaurar: (c) => pantalla.pendiente.restaurar(c),
      emitir: pantalla.emitir
    },
    memoria,
    contadorUso
  )

  registrarAtajos(
    { alternarPanel: () => orbe.alternar(), leerPantalla: () => void pantalla.leerConAtajo() },
    { panel: config.atajoPanel, leer: config.atajoLeer }
  )

  // Icono de la bandeja del sistema (en la prueba de humo no se crea: no debe dejar un icono en la barra del usuario).
  if (!modoHumo) {
    const mostrarPanel = (): void => {
      orbe.mostrar()
      orbe.establecerExpandido(true)
    }
    bandeja = crearBandeja(
      {
        alternarVisibilidad: () => orbe.alternarVisibilidad(),
        mostrarPanel,
        nuevaConversacion: () => {
          mostrarPanel()
          orbe.ventana.webContents.send(CANALES.appOrden, 'nueva-conversacion')
        },
        leerPantalla: () => void pantalla.leerConAtajo(),
        detenerAccion: () => servicioChat?.cancelarActivo(),
        salir: () => app.quit()
      },
      () => orbe.estaVisible,
      app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
      () => servicioChat?.hayTurno ?? false
    )
  }

  if (fuenteDemo && capturaDemo) {
    void ejecutarHumo(orbe, humoReal, { fuente: fuenteDemo, leerConAtajo: pantalla.leerConAtajo, memoria, captura: capturaDemo, ocr: ocrDemo ?? undefined, actividad })
  }
})

app.on('second-instance', () => {
  ventanaOrbe?.mostrar()
})

// El orbe vive en segundo plano: cerrar la ventana no cierra la app (se sale desde la bandeja).
app.on('window-all-closed', () => {})

app.on('will-quit', () => {
  liberarAtajos()
  servicioChat?.cerrar()
  helper?.cerrar()
  bandeja?.destroy()
})
