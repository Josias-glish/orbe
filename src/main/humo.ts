import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FuenteDemo } from './pantalla/fuente-demo'
import type { VentanaOrbe } from './ventana'

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Lo que la prueba de humo necesita del lector de pantalla para ensayar la fase 3 sin tocar la pantalla real. */
export interface ExtrasHumo {
  fuente: FuenteDemo
  /** Lo mismo que hace el atajo «leer pantalla». */
  leerConAtajo: () => Promise<void>
}

/**
 * Prueba de humo (`npm run humo`): arranca con un proveedor y un lector de pantalla de mentira, recorre
 * los estados del orbe, una conversación de ejemplo y la lectura de pantalla, guarda capturas del render
 * en humo/ y sale (con código 1 si alguna comprobación falla).
 * Con `real` (`npm run humo:real`) conversa de verdad con Claude a través de la configuración del usuario.
 */
export async function ejecutarHumo(orbe: VentanaOrbe, real = false, extras?: ExtrasHumo): Promise<void> {
  const carpeta = join(process.cwd(), 'humo')
  mkdirSync(carpeta, { recursive: true })
  const wc = orbe.ventana.webContents
  const informe: Record<string, unknown> = {}
  const fallos: string[] = []
  /** Anota un fallo si la condición no se cumple; el resultado final lo recoge. */
  const comprobar = (nombre: string, ok: boolean, detalle?: unknown): void => {
    if (!ok) fallos.push(detalle === undefined ? nombre : `${nombre} (${JSON.stringify(detalle)})`)
  }

  const js = <T = unknown>(codigo: string): Promise<T> => wc.executeJavaScript(codigo) as Promise<T>
  const capturas: Record<string, string> = {}
  informe.capturas = capturas
  const capturar = async (nombre: string): Promise<void> => {
    const imagen = await wc.capturePage()
    const png = imagen.toPNG()
    const { width, height } = imagen.getSize()
    const ventana = orbe.ventana.getBounds()
    capturas[nombre] =
      `${width}x${height} (ventana ${ventana.width}x${ventana.height}, ${orbe.estaExpandido ? 'expandida' : 'colapsada'}, ${orbe.estaVisible ? 'visible' : 'OCULTA'})`
    // Una captura casi vacía indica que la ventana no estaba pintando: la prueba no valdría de nada.
    comprobar(`captura ${nombre} vacía`, png.length > 3000, capturas[nombre])
    writeFileSync(join(carpeta, `${nombre}.png`), png)
  }
  /** Escribe en el campo de entrada y pulsa Enter, como haría una persona. */
  const escribirYEnviar = (texto: string): Promise<unknown> =>
    js(`(() => {
      const t = document.getElementById('entrada');
      t.value = ${JSON.stringify(texto)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    })()`)
  const estadoOrbe = (): Promise<string> => js('window.__orbeDiagnostico().estado')
  const contar = (selector: string): Promise<number> => js(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
  /** Espera a que termine la respuesta en curso (el botón vuelve a ser «Enviar»). */
  const esperarFin = async (maximoMs: number): Promise<boolean> => {
    const limite = Date.now() + maximoMs
    while (Date.now() < limite) {
      const enCurso = await js<boolean>(`document.getElementById('enviar').classList.contains('detener')`)
      if (!enCurso) return true
      await esperar(150)
    }
    return false
  }
  const existe = (selector: string): Promise<boolean> => js(`document.querySelector(${JSON.stringify(selector)}) !== null`)
  const textoDe = async (selector: string): Promise<string> =>
    (await js<string | null>(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`)) ?? ''
  const textosDe = (selector: string): Promise<string[]> =>
    js(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => e.textContent)`)
  /** Pulsa el primer elemento que cumpla el selector, como un clic de verdad. */
  const pulsar = (selector: string): Promise<boolean> =>
    js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true })()`)
  const esperarSelector = async (selector: string, maximoMs: number): Promise<boolean> => {
    const limite = Date.now() + maximoMs
    while (Date.now() < limite) {
      if (await existe(selector)) return true
      await esperar(100)
    }
    return false
  }
  const mismos = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

  /** Fase 3: lectura de pantalla bajo demanda, ensayada con un lector de mentira (nunca se lee la pantalla real). */
  const pasosPantalla = async ({ fuente, leerConAtajo }: ExtrasHumo): Promise<void> => {
    const p: Record<string, unknown> = {}
    informe.pantalla = p
    const hayBarra = '#pendiente:not([hidden]) .chip'
    const chipsPendientes = (): Promise<string[]> => textosDe('#pendiente .chip .chip-etiqueta')
    const ultimaRespuesta = (): Promise<string> => js(`[...document.querySelectorAll('.msg.asistente .contenido')].at(-1)?.textContent ?? ''`)
    const nuevaConversacion = async (): Promise<void> => {
      await pulsar('#nueva')
      await esperar(400)
    }

    // 6a. El ojo lee la ventana: el orbe hace su destello y aparecen los chips con lo que se enviaría
    await nuevaConversacion()
    fuente.escenario = 'contenido'
    await pulsar('#leer')
    await esperar(450)
    p.orbeLeyendo = await estadoOrbe()
    p.botonLeyendo = await existe('#leer.leyendo')
    await capturar('6a-leyendo')
    comprobar('el orbe pasa a «leyendo» al leer', p.orbeLeyendo === 'leyendo', p.orbeLeyendo)
    comprobar('el ojo late mientras lee', p.botonLeyendo === true)
    comprobar('aparece la barra de contexto', await esperarSelector(hayBarra, 4000))
    await esperar(300)
    p.chips = await chipsPendientes()
    p.orbeTrasLeer = await estadoOrbe()
    await capturar('6a-pendiente')
    comprobar('lee ventana y contenido', mismos(p.chips, ['Ventana', 'Contenido']), p.chips)
    comprobar('el orbe vuelve a reposo', p.orbeTrasLeer === 'reposo', p.orbeTrasLeer)

    // 6b. Vista previa de lo que viajaría: la dirección va sin parámetros
    await pulsar('#pendiente .chip-ventana')
    await esperar(150)
    p.vistaVentana = await textoDe('#pendiente .chip-vista-texto')
    comprobar(
      'la dirección se muestra sin parámetros',
      String(p.vistaVentana).includes('Dirección: https://example.com/recetas/tortilla\n') &&
        !/utm_source|abc123|sesion/.test(String(p.vistaVentana)),
      p.vistaVentana
    )
    comprobar('avisa de que se omitieron parámetros', String(p.vistaVentana).includes('omitido'))
    await pulsar('#pendiente .chip-contenido')
    await esperar(150)
    p.vistaContenido = (await textoDe('#pendiente .chip-vista-texto')).slice(0, 60)
    comprobar('la vista del contenido es la receta', String(p.vistaContenido).startsWith('Receta de tortilla'), p.vistaContenido)
    await capturar('6b-vista-contenido')

    // 6c. Quitar un chip: el contenido deja de enviarse y la ventana se queda; «Descartar» vacía la barra
    await pulsar('#pendiente .chip-contenido + .chip-quitar')
    await esperar(400)
    p.chipsTrasQuitar = await chipsPendientes()
    comprobar('quitar el contenido deja solo la ventana', mismos(p.chipsTrasQuitar, ['Ventana']), p.chipsTrasQuitar)
    await capturar('6c-sin-contenido')
    await pulsar('.pendiente-descartar')
    await esperar(250)
    p.barraOcultaTrasDescartar = await js(`document.getElementById('pendiente').hidden`)
    comprobar('descartar oculta la barra', p.barraOcultaTrasDescartar === true)

    // 6d. Con texto seleccionado solo viajan la ventana y la selección (el contenido entero sería ruido)
    fuente.escenario = 'seleccion'
    await pulsar('#leer')
    comprobar('aparece la barra con selección', await esperarSelector(hayBarra, 4000))
    await esperar(300)
    p.chipsSeleccion = await chipsPendientes()
    comprobar('con selección no se añade el contenido', mismos(p.chipsSeleccion, ['Ventana', 'Selección']), p.chipsSeleccion)
    await capturar('6d-seleccion')

    // 6e. Se envía con el contexto: la barra se vacía y los chips quedan colgados del mensaje
    await escribirYEnviar('¿Qué opinas de esta frase?')
    await esperar(500)
    p.barraOcultaAlEnviar = await js(`document.getElementById('pendiente').hidden`)
    p.terminoConContexto = await esperarFin(15_000)
    await esperar(500)
    p.adjuntosEnMensaje = await textosDe('.msg.usuario .adjuntos .chip .chip-etiqueta')
    p.acuseDemo = (await ultimaRespuesta()).slice(0, 70)
    comprobar('la barra se vacía al enviar', p.barraOcultaAlEnviar === true)
    comprobar('los chips cuelgan del mensaje', mismos(p.adjuntosEnMensaje, ['Ventana', 'Selección']), p.adjuntosEnMensaje)
    comprobar(
      'el modelo recibió ventana y selección, sin contenido',
      String(p.acuseDemo).includes('ventana, selección') && !String(p.acuseDemo).includes('contenido'),
      p.acuseDemo
    )
    await pulsar('.msg.usuario .adjuntos .chip-seleccion')
    await esperar(200)
    p.vistaAdjunto = (await textoDe('.msg.usuario .adjuntos .chip-vista-texto')).slice(0, 50)
    comprobar('el chip del mensaje despliega lo enviado', String(p.vistaAdjunto).startsWith('Cuaja la tortilla'), p.vistaAdjunto)
    await capturar('6e-enviado')

    // 6f. Sin leer la pantalla no viaja nada
    await escribirYEnviar('Gracias')
    await esperarFin(15_000)
    await esperar(400)
    p.adjuntosTotales = await contar('.msg.usuario .adjuntos')
    p.acuseSinLeer = (await ultimaRespuesta()).includes('Recibí contexto')
    comprobar('sin lectura no se adjunta nada', p.adjuntosTotales === 1 && p.acuseSinLeer === false, [p.adjuntosTotales, p.acuseSinLeer])

    // 6g. Muy poco texto: avisa (la captura de respaldo llega en la fase 4)
    await nuevaConversacion()
    fuente.escenario = 'poco'
    await pulsar('#leer')
    comprobar('aparece la barra con poco texto', await esperarSelector(hayBarra, 4000))
    await esperar(300)
    p.avisoPoco = await textoDe('#pendiente .pendiente-aviso')
    comprobar('avisa de que hay poco texto', /poco texto/i.test(String(p.avisoPoco)), p.avisoPoco)
    await capturar('6g-poco-texto')
    await pulsar('.pendiente-descartar')

    // 6h. Cuando el lector no puede, lo dice con claridad
    fuente.escenario = 'vacio'
    await pulsar('#leer')
    comprobar('aparece el aviso de ventana vacía', await esperarSelector('#pendiente:not([hidden]) .pendiente-aviso', 4000))
    p.avisoVacio = await textoDe('#pendiente .pendiente-aviso')
    comprobar('explica que no hay texto que leer', /no muestra texto/i.test(String(p.avisoVacio)), p.avisoVacio)
    await pulsar('.pendiente-descartar')

    fuente.escenario = 'sin_ventana'
    await pulsar('#leer')
    comprobar('sale la tarjeta de «sin ventana»', await esperarSelector('.tarjeta-error', 4000))
    p.errorSinVentana = await textoDe('.tarjeta-error .error-titulo')
    await capturar('6h-sin-ventana')
    await nuevaConversacion()

    fuente.escenario = 'error'
    await pulsar('#leer')
    comprobar('sale la tarjeta del lector roto', await esperarSelector('.tarjeta-error', 4000))
    p.errorLector = { titulo: await textoDe('.tarjeta-error .error-titulo'), mensaje: await textoDe('.tarjeta-error .error-mensaje') }
    await capturar('6h-error-lector')
    await nuevaConversacion()

    // 6i. El atajo lee con el panel cerrado y lo abre con el contexto ya listo
    fuente.escenario = 'contenido'
    orbe.establecerExpandido(false)
    await esperar(600)
    p.boundsAntesDelAtajo = orbe.ventana.getBounds()
    await leerConAtajo()
    await esperar(600)
    p.boundsTrasAtajo = orbe.ventana.getBounds()
    comprobar('el atajo abre el panel', orbe.ventana.getBounds().width > 300, p.boundsTrasAtajo)
    comprobar('el atajo deja el contexto listo', await esperarSelector(hayBarra, 4000))
    await esperar(300)
    p.chipsAtajo = await chipsPendientes()
    comprobar('el atajo lee ventana y contenido', mismos(p.chipsAtajo, ['Ventana', 'Contenido']), p.chipsAtajo)
    await capturar('6i-atajo')
    await pulsar('.pendiente-descartar')
    await esperar(300)
  }

  try {
    await new Promise<void>((r) => (wc.isLoading() ? wc.once('did-finish-load', () => r()) : r()))
    await esperar(1200)
    informe.webgl = await js('window.__orbeDiagnostico()')

    if (real) {
      // Conversación real: dos turnos para comprobar el streaming y la memoria.
      orbe.establecerExpandido(true)
      await esperar(700)
      informe.cabecera = await js(`document.getElementById('modelo')?.textContent`)
      await escribirYEnviar('Hola. Recuerda que mi número favorito es el 7. Preséntate en una frase.')
      await esperar(600)
      informe.orbeAlEnviar = await estadoOrbe()
      informe.terminoPrimero = await esperarFin(90_000)
      await esperar(700)
      await capturar('r-1-respuesta')
      await escribirYEnviar('¿Cuál era mi número favorito? Responde solo con el número.')
      informe.terminoSegundo = await esperarFin(90_000)
      await esperar(700)
      await capturar('r-2-memoria')
      informe.ultimaRespuesta = await js(`[...document.querySelectorAll('.msg.asistente .contenido')].at(-1)?.textContent`)
      informe.errores = await contar('.tarjeta-error')
      informe.burbujas = { usuario: await contar('.msg.usuario'), asistente: await contar('.msg.asistente') }
    } else {
      // 1. Estados del orbe
      for (const estado of ['reposo', 'leyendo', 'pensando', 'respondiendo']) {
        await js(`window.__orbeEstado(${JSON.stringify(estado)})`)
        await esperar(estado === 'leyendo' ? 500 : 900)
        await capturar(`1-${estado}`)
      }
      await js(`window.__orbeEstado('reposo')`)

      // 2. Panel expandido, vacío
      orbe.establecerExpandido(true)
      await esperar(700)
      await capturar('2-expandido')
      informe.boundsExpandido = orbe.ventana.getBounds()
      informe.cabecera = await js(`document.getElementById('modelo')?.textContent`)

      // 3. Conversación de ejemplo con streaming
      await escribirYEnviar('Hola, ¿qué puedes hacer por mí?')
      await esperar(350)
      informe.orbePensando = await estadoOrbe()
      await capturar('3-pensando')
      await esperar(1100)
      informe.orbeRespondiendo = await estadoOrbe()
      await capturar('3-streaming')
      await esperar(2600)
      informe.orbeFinal = await estadoOrbe()
      await capturar('3-respuesta')
      informe.burbujas = {
        usuario: await contar('.msg.usuario'),
        asistente: await contar('.msg.asistente'),
        bloquesCodigo: await contar('.msg.asistente pre code'),
        listas: await contar('.msg.asistente li'),
        enlaces: await contar('.msg.asistente a[href]')
      }

      // 4. Error
      await escribirYEnviar('/error simulado')
      await esperar(1500)
      await capturar('4-error')
      informe.tarjetasError = await contar('.tarjeta-error')
      informe.botonReintentar = await contar('.tarjeta-error button')

      // 5. Nueva conversación
      await js(`document.getElementById('nueva')?.click()`)
      await esperar(400)
      informe.mensajesTrasNueva = await contar('.msg')
      await capturar('5-nueva')

      // 6. Lectura de pantalla (fase 3)
      if (extras) await pasosPantalla(extras)

      orbe.establecerExpandido(false)
      await esperar(400)
      informe.boundsColapsado = orbe.ventana.getBounds()
      // En reposo estable el orbe debe quedarse en ~30 fps como máximo.
      await esperar(2600)
      informe.fpsReposo = await js('window.__orbeDiagnostico().fps')
    }
  } catch (error) {
    informe.error = String(error)
  }

  informe.fallos = fallos
  writeFileSync(join(carpeta, real ? 'informe-real.json' : 'informe.json'), JSON.stringify(informe, null, 2))
  console.log('HUMO', JSON.stringify(informe))
  BrowserWindow.getAllWindows().forEach((w) => w.destroy())
  app.exit(informe.error || fallos.length > 0 ? 1 : 0)
}
