import { app, BrowserWindow } from 'electron'
import { CANALES } from '../shared/tipos'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { leerAjustes } from './ajustes'
import { ALTO_EXTRA_ORBE, TAM_PANEL_MIN, panelDeVentana } from './geometria'
import type { ServicioMemoria } from './memoria/servicio'
import type { CapturaDemo } from './pantalla/captura-demo'
import type { FuenteDemo } from './pantalla/fuente-demo'
import type { VentanaOrbe } from './ventana'

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Lo que la prueba de humo necesita del lector de pantalla y de la memoria para ensayarlos sin tocar datos reales. */
export interface ExtrasHumo {
  fuente: FuenteDemo
  /** Lo mismo que hace el atajo «leer pantalla». */
  leerConAtajo: () => Promise<void>
  /** La memoria de la prueba (con notas de mentira), para comprobar también por el lado del proceso principal. */
  memoria: ServicioMemoria
  /** La captura de mentira de la prueba (para hacerla fallar a propósito y contar cuántas veces se ocultó la ventana). */
  captura: CapturaDemo
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

  /** Memoria: gestor, notas, órdenes «recuerda que…», deshacer, conversación repuesta e interruptor. */
  const pasosMemoria = async ({ memoria }: ExtrasHumo): Promise<void> => {
    const m: Record<string, unknown> = {}
    informe.memoria = m
    const medidor = (): Promise<number> => js(`Number(document.querySelector('#memoria .medidor').getAttribute('aria-valuenow'))`)
    const gestorAbierto = (): Promise<boolean> => js(`!document.getElementById('memoria').hidden`)
    const filaDe = (tipo: string): string => `document.querySelector('#memoria .tipo-${tipo}').closest('.recuerdo')`
    /** Escribe en el cuadro de «nuevo recuerdo» y lo envía como haría una persona (Enter). */
    const anadirNota = (texto: string): Promise<unknown> =>
      js(`(() => {
        const t = document.querySelector('#memoria .memoria-texto');
        t.value = ${JSON.stringify(texto)};
        t.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('#memoria .memoria-nueva').requestSubmit();
      })()`)
    const ultimaRespuesta = (): Promise<string> => js(`[...document.querySelectorAll('.msg.asistente .contenido')].at(-1)?.textContent ?? ''`)

    // 7a. El botón de memoria abre el gestor con lo importado de Claude (menos la referencia y la nota con una clave)
    await pulsar('#nueva')
    await esperar(400)
    await pulsar('#memoria-boton')
    comprobar('se abre el gestor', await esperarSelector('#memoria:not([hidden]) .recuerdo', 3000))
    await esperar(200)
    m.recuerdos = await textosDe('#memoria .recuerdo .recuerdo-texto')
    m.etiquetas = (await textosDe('#memoria .recuerdo .etiqueta-tipo')).sort()
    m.resumen = await textoDe('#memoria .memoria-resumen')
    m.chatOculto = await js(`document.querySelector('.panel-cuerpo').hidden`)
    comprobar('hay tres recuerdos importados', (m.recuerdos as string[]).length === 3, m.recuerdos)
    comprobar('son un perfil, una preferencia y un proyecto', mismos(m.etiquetas, ['Perfil', 'Preferencia', 'Proyecto']), m.etiquetas)
    comprobar('el gestor sustituye al chat', m.chatOculto === true)
    comprobar('el resumen cuenta lo que viaja', /3 recuerdos · [\d.]+ de 6\.?000 caracteres/.test(String(m.resumen)), m.resumen)
    await capturar('7a-gestor')

    // 7b. Abrir un recuerdo, marcar «texto completo» y comprobar que pesa más
    m.usadosAntes = await medidor()
    await js(`${filaDe('proyecto')}.querySelector('.recuerdo-titulo').click()`)
    await esperar(150)
    comprobar('se despliega el detalle', await existe('#memoria .recuerdo-detalle'))
    await js(`(() => { const c = document.querySelector('#memoria .recuerdo-detalle .memoria-opcion input'); c.checked = true })()`)
    await js(`[...document.querySelectorAll('#memoria .recuerdo-detalle .boton-memoria')].find((b) => b.textContent.includes('Guardar')).click()`)
    await esperar(400)
    m.usadosDespues = await medidor()
    comprobar('con el texto completo viaja más', (m.usadosDespues as number) > (m.usadosAntes as number), [m.usadosAntes, m.usadosDespues])
    comprobar('el proceso principal lo confirma', (memoria.bloquePrompt() ?? '').includes('Detalles del huerto de ejemplo'))
    await capturar('7b-detalle')

    // 7c. Dejar de usar un recuerdo
    await js(`${filaDe('preferencia')}.querySelector('.recuerdo-usar').click()`)
    await esperar(400)
    m.pesoDesactivado = await js(`${filaDe('preferencia')}.querySelector('.recuerdo-peso').textContent`)
    comprobar('un recuerdo desactivado no pesa', m.pesoDesactivado === '—', m.pesoDesactivado)
    comprobar('y deja de viajar', !(memoria.bloquePrompt() ?? '').includes('explicaciones breves'))

    // 7d. Añadir una nota a mano
    await anadirNota('Me encanta el cine de acción')
    await esperar(400)
    m.tras = await textosDe('#memoria .recuerdo .recuerdo-texto')
    comprobar('la nota nueva aparece', (m.tras as string[]).some((t) => t.includes('cine de acción')), m.tras)
    comprobar('y se guarda en la carpeta', memoria.estado().recuerdos.some((r) => r.titulo === 'Me encanta el cine de acción' && r.tipo === 'nota'))

    // 7e. Un dato delicado se rechaza y solo se guarda si el usuario insiste
    await anadirNota('mi contraseña es hunter22')
    await esperar(400)
    m.errorDelicado = await textoDe('#memoria .memoria-error')
    comprobar('avisa de que parece una contraseña', /Parece contener una contraseña/.test(String(m.errorDelicado)), m.errorDelicado)
    comprobar('ofrece guardarlo igualmente', await existe('#memoria .memoria-error .boton-memoria'))
    comprobar('no lo guardó', !memoria.estado().recuerdos.some((r) => r.titulo.includes('hunter22')))
    await capturar('7e-delicado')
    await js(`(() => { const t = document.querySelector('#memoria .memoria-texto'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })) })()`)

    // 7f. Volver a importar de Claude: no hay nada nuevo y dice qué dejó fuera y por qué
    await js(`[...document.querySelectorAll('#memoria .boton-memoria')].find((b) => b.textContent.includes('Importar')).click()`)
    await esperar(500)
    m.informe = await textoDe('#memoria .memoria-informe')
    comprobar('el informe cuenta lo importado y lo omitido', /3 sin cambios/.test(String(m.informe)) && /clave-demo/.test(String(m.informe)), m.informe)
    await js(`document.querySelector('#memoria .memoria-cuerpo').scrollTop = 9999`)
    await esperar(150)
    await capturar('7f-informe')

    // 7g. Volver al chat y pedir que recuerde algo: lo guarda la aplicación y el usuario ve el aviso
    await js(`document.querySelector('#memoria .memoria-cabecera .boton-icono').click()`)
    await esperar(300)
    comprobar('vuelve el chat', !(await gestorAbierto()) && (await js<boolean>(`!document.querySelector('.panel-cuerpo').hidden`)))
    await escribirYEnviar('Recuerda que mi comida favorita es la tortilla de patatas')
    await esperar(500)
    m.avisoGuardado = await textoDe('.msg.usuario .nota-memoria')
    comprobar('el mensaje enseña «Guardado en la memoria»', /Guardado en la memoria/.test(String(m.avisoGuardado)), m.avisoGuardado)
    comprobar('con un botón para deshacerlo', await existe('.msg.usuario .nota-memoria-deshacer'))
    comprobar('el proceso principal la guardó', memoria.estado().recuerdos.some((r) => r.cuerpo === 'Mi comida favorita es la tortilla de patatas'))
    await esperarFin(15_000)
    await esperar(400)
    m.acuseNota = (await ultimaRespuesta()).slice(0, 80)
    comprobar('el modelo recibió la nota de la aplicación', String(m.acuseNota).includes('nota de la app'), m.acuseNota)
    await capturar('7g-recordado')

    // 7h. Deshacer
    await pulsar('.msg.usuario .nota-memoria-deshacer')
    await esperar(400)
    m.avisoDeshecho = await textoDe('.msg.usuario .nota-memoria')
    comprobar('deshacer lo borra', /Recuerdo borrado/.test(String(m.avisoDeshecho)), m.avisoDeshecho)
    comprobar('y ya no está en la memoria', !memoria.estado().recuerdos.some((r) => r.cuerpo.includes('tortilla de patatas')))

    // 7i. Una orden con un dato delicado no se guarda, y se le explica al usuario
    await escribirYEnviar('Recuerda que mi contraseña es hunter22')
    await esperar(500)
    m.avisoRechazo = await js<string>(`[...document.querySelectorAll('.msg.usuario')].at(-1)?.querySelector('.nota-memoria')?.textContent ?? ''`)
    comprobar('explica por qué no se guardó', m.avisoRechazo === 'No se guardó: parece contener una contraseña o una clave', m.avisoRechazo)
    await esperarFin(15_000)
    await esperar(400)
    await capturar('7i-no-guardado')

    // 7j. Al reabrir la interfaz, la conversación se repone (aquí se recarga la página, como al volver a abrir Orbe)
    m.usuariosAntes = await contar('.msg.usuario')
    await wc.reload()
    await new Promise<void>((r) => (wc.isLoading() ? wc.once('did-finish-load', () => r()) : r()))
    await esperar(800)
    orbe.establecerExpandido(false)
    await esperar(300)
    orbe.establecerExpandido(true)
    await esperar(700)
    m.usuariosRepuestos = await contar('.msg.usuario')
    m.asistenteRepuestos = await contar('.msg.asistente')
    m.avisoRepuesto = await textoDe('#mensajes .aviso')
    comprobar('se reponen los mensajes del usuario', m.usuariosRepuestos === m.usuariosAntes && m.usuariosRepuestos === 2, [m.usuariosAntes, m.usuariosRepuestos])
    comprobar('se reponen las respuestas', m.asistenteRepuestos === 2, m.asistenteRepuestos)
    comprobar('avisa de que es la conversación anterior', /Conversación anterior restaurada/.test(String(m.avisoRepuesto)), m.avisoRepuesto)
    comprobar('no repite el aviso de la importación', !String(m.avisoRepuesto).includes('He cargado'))
    await capturar('7j-restaurada')

    // 7k. El interruptor apaga la memoria: no viaja nada y los recuerdos se ven atenuados
    await pulsar('#memoria-boton')
    await esperarSelector('#memoria:not([hidden]) .recuerdo', 3000)
    await js(`document.getElementById('memoria-activa').click()`)
    await esperar(400)
    m.interruptor = await textoDe('#memoria .interruptor-texto')
    comprobar('el interruptor dice «Apagada»', m.interruptor === 'Apagada', m.interruptor)
    m.resumenApagada = await textoDe('#memoria .memoria-resumen')
    comprobar('el resumen avisa de que no se usa nada', /Memoria apagada/.test(String(m.resumenApagada)), m.resumenApagada)
    comprobar('con la memoria apagada no viaja nada', memoria.bloquePrompt() === undefined)
    await capturar('7k-apagada')
    await js(`document.getElementById('memoria-activa').click()`)
    await esperar(300)
    comprobar('al encenderla vuelve a viajar', memoria.bloquePrompt() !== undefined)
    await pulsar('#memoria-boton')
    await esperar(300)
    comprobar('se cierra el gestor', !(await gestorAbierto()))
  }

  /** Captura de respaldo (fase 4): sugerencia, confirmación, vista previa, envío, poco texto, errores. */
  const pasosCaptura = async ({ fuente, captura }: ExtrasHumo): Promise<void> => {
    const c: Record<string, unknown> = {}
    informe.captura = c
    const base = captura.ocultadas
    const escribir = (texto: string): Promise<unknown> =>
      js(`(() => { const t = document.getElementById('entrada'); t.value = ${JSON.stringify(texto)}; t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    const oculto = (selector: string): Promise<boolean> => js(`document.querySelector(${JSON.stringify(selector)}).hidden`)
    const chipsPendientes = (): Promise<string[]> => textosDe('#pendiente .chip .chip-etiqueta')
    const ultimaRespuesta = (): Promise<string> => js(`[...document.querySelectorAll('.msg.asistente .contenido')].at(-1)?.textContent ?? ''`)
    const nueva = async (): Promise<void> => {
      await pulsar('#nueva')
      await esperar(400)
    }
    /** Pulsa la cámara y confirma, como haría una persona. */
    const capturarConfirmando = async (): Promise<void> => {
      await pulsar('#capturar')
      await esperarSelector('#confirmacion:not([hidden]) .confirmacion-capturar', 2000)
      await pulsar('.confirmacion-capturar')
    }

    // 8a. Una pregunta que suena visual sugiere la captura, pero no la hace
    await nueva()
    fuente.escenario = 'contenido'
    await escribir('¿Cómo se ve este diseño?')
    await esperar(250)
    c.sugerenciaVisual = await textoDe('#sugerencia .sugerencia-texto')
    comprobar('una pregunta visual sugiere la captura', /cómo se ve algo/.test(String(c.sugerenciaVisual)), c.sugerenciaVisual)
    comprobar('pero no la hace sola', captura.ocultadas === base)
    await capturar('8a-sugerencia')

    // 8b. La cámara pide confirmación explicando qué va a pasar; cancelar no captura nada
    await pulsar('#capturar')
    comprobar('pide confirmación', await esperarSelector('#confirmacion:not([hidden]) .confirmacion-capturar', 2000))
    c.textoConfirmacion = await textoDe('#confirmacion')
    comprobar('explica que oculta Orbe y que se verá antes de enviar', /Ocultaré Orbe/.test(String(c.textoConfirmacion)) && /antes de enviarla/.test(String(c.textoConfirmacion)), c.textoConfirmacion)
    comprobar('todavía no ha capturado', captura.ocultadas === base)
    await capturar('8b-confirmacion')
    await pulsar('.confirmacion-cancelar')
    await esperar(200)
    comprobar('cancelar no captura nada', captura.ocultadas === base && (await oculto('#confirmacion')))

    // 8c. Esc también cancela la confirmación, sin cerrar el panel
    await pulsar('#capturar')
    await esperarSelector('#confirmacion:not([hidden])', 2000)
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await esperar(250)
    comprobar('Esc cancela la confirmación', await oculto('#confirmacion'))
    comprobar('y el panel sigue abierto', orbe.estaExpandido)
    comprobar('sin capturar', captura.ocultadas === base)

    // 8d. Al confirmar, la captura queda pendiente con su vista previa ya desplegada
    await capturarConfirmando()
    comprobar('aparece el chip de la captura', await esperarSelector('#pendiente:not([hidden]) .chip-imagen', 5000))
    await esperar(400)
    c.chips = await chipsPendientes()
    c.resumenCaptura = await textoDe('#pendiente .chip-imagen .chip-resumen')
    c.miniatura = await js(`(() => { const i = document.querySelector('#pendiente .chip-miniatura'); return i ? [i.naturalWidth, i.naturalHeight] : null })()`)
    comprobar('es una sola captura', mismos(c.chips, ['Captura']), c.chips)
    comprobar('el resumen dice las medidas reducidas', /^1500×844 · [\d.]+ KB$/.test(String(c.resumenCaptura)), c.resumenCaptura)
    comprobar('la vista previa se despliega sola y carga', Array.isArray(c.miniatura) && (c.miniatura as number[])[0] > 100, c.miniatura)
    comprobar('Orbe se ocultó y volvió una vez', captura.ocultadas === base + 1 && captura.restauradas === base + 1, [captura.ocultadas, captura.restauradas])
    comprobar('la sugerencia desaparece', await oculto('#sugerencia'))
    await capturar('8d-captura')

    // 8e. Se envía con la captura: el modelo la recibe y el chip cuelga del mensaje
    await escribirYEnviar('¿Cómo se ve este diseño?')
    await esperar(500)
    comprobar('la barra se vacía al enviar', await oculto('#pendiente'))
    c.adjuntos = await textosDe('.msg.usuario .adjuntos .chip .chip-etiqueta')
    comprobar('el chip cuelga del mensaje', mismos(c.adjuntos, ['Captura']), c.adjuntos)
    await esperarFin(15_000)
    await esperar(400)
    c.acuse = (await ultimaRespuesta()).slice(0, 70)
    comprobar('el modelo recibió la captura', String(c.acuse).includes('captura'), c.acuse)
    await pulsar('.msg.usuario .adjuntos .chip-imagen')
    await esperar(300)
    c.miniaturaEnMensaje = await js(`(() => { const i = document.querySelector('.msg.usuario .adjuntos .chip-miniatura'); return i ? i.naturalWidth : 0 })()`)
    comprobar('la miniatura se ve en el mensaje enviado', (c.miniaturaEnMensaje as number) > 100, c.miniaturaEnMensaje)
    await capturar('8e-enviada')

    // 8f. Poco texto en la ventana: lo sugiere; se hace la captura desde la sugerencia y se puede quitar
    await nueva()
    fuente.escenario = 'poco'
    await pulsar('#leer')
    await esperarSelector('#pendiente:not([hidden]) .chip', 4000)
    await esperar(300)
    c.sugerenciaPoco = await textoDe('#sugerencia .sugerencia-texto')
    comprobar('con poco texto sugiere la captura', /¿Adjuntas una captura\?/.test(String(c.sugerenciaPoco)), c.sugerenciaPoco)
    comprobar('y la barra explica por qué', /muy poco texto/.test(await textoDe('#pendiente .pendiente-aviso')))
    await capturar('8f-poco-texto')
    await pulsar('#sugerencia .sugerencia-accion')
    await esperarSelector('#confirmacion:not([hidden]) .confirmacion-capturar', 2000)
    await pulsar('.confirmacion-capturar')
    comprobar('la captura se suma a lo leído', await esperarSelector('#pendiente .chip-imagen', 5000))
    await esperar(400)
    c.chipsConCaptura = await chipsPendientes()
    comprobar('ventana, contenido y captura', mismos(c.chipsConCaptura, ['Ventana', 'Contenido', 'Captura']), c.chipsConCaptura)
    comprobar('ya no sugiere otra', await oculto('#sugerencia'))
    await pulsar('#pendiente .chip-imagen + .chip-quitar')
    await esperar(400)
    c.chipsSinCaptura = await chipsPendientes()
    comprobar('quitar la captura deja lo demás', mismos(c.chipsSinCaptura, ['Ventana', 'Contenido']), c.chipsSinCaptura)
    await pulsar('.pendiente-descartar')

    // 8g. Si la captura falla: mensaje claro con «Reintentar», y Orbe vuelve
    await nueva()
    captura.falla = true
    const antes = captura.restauradas
    await capturarConfirmando()
    comprobar('sale la tarjeta de error', await esperarSelector('.tarjeta-error', 5000))
    c.errorCaptura = { titulo: await textoDe('.tarjeta-error .error-titulo'), detalle: await textoDe('.tarjeta-error .error-detalle code') }
    comprobar('es el error de captura', (c.errorCaptura as { titulo: string }).titulo === 'No he podido hacer la captura', c.errorCaptura)
    comprobar('con «Reintentar»', await existe('.tarjeta-error .boton-secundario'))
    comprobar('Orbe volvió a su sitio', captura.restauradas === antes + 1, [captura.restauradas, antes])
    await capturar('8g-error')
    captura.falla = false
    await pulsar('.tarjeta-error .boton-secundario')
    comprobar('«Reintentar» vuelve a pedir confirmación', await esperarSelector('#confirmacion:not([hidden])', 2000))
    await pulsar('.confirmacion-cancelar')
    await esperar(200)

    // 8h. Cerrar la sugerencia la silencia hasta el siguiente mensaje
    await nueva()
    await escribir('Mira esta imagen')
    await esperar(250)
    comprobar('la sugerencia aparece', !(await oculto('#sugerencia')))
    await pulsar('#sugerencia .sugerencia-cerrar')
    await esperar(150)
    await escribir('Mira esta imagen, por favor')
    await esperar(250)
    comprobar('cerrada, no vuelve mientras sigues escribiendo', await oculto('#sugerencia'))
    await escribir('')
  }

  /** Tamaño del panel (se puede cambiar arrastrando un borde) y fondo del chat. */
  const pasosPanel = async (): Promise<void> => {
    const p: Record<string, unknown> = {}
    informe.panel = p
    const bounds = (): { x: number; y: number; width: number; height: number } => orbe.ventana.getBounds()
    /** Con una escala de pantalla fraccionaria Windows puede redondear un píxel. */
    const casi = (a: number, b: number): boolean => Math.abs(a - b) <= 1
    /** Arrastra un agarre con eventos de puntero de verdad (pulsar, mover, soltar), como haría una persona. */
    const arrastrar = (selector: string, dx: number, dy: number): Promise<unknown> =>
      js(`(() => {
        const a = document.querySelector(${JSON.stringify(selector)});
        const r = a.getBoundingClientRect();
        const x0 = window.screenX + r.left + r.width / 2, y0 = window.screenY + r.top + r.height / 2;
        const ev = (tipo, x, y) => a.dispatchEvent(new PointerEvent(tipo, { bubbles: true, button: 0, pointerId: 7, screenX: x, screenY: y }));
        ev('pointerdown', x0, y0);
        ev('pointermove', x0 + ${dx} / 2, y0 + ${dy} / 2);
        ev('pointermove', x0 + ${dx}, y0 + ${dy});
        ev('pointerup', x0 + ${dx}, y0 + ${dy});
      })()`)
    const medidasPanel = (): Promise<{ ancho: number; alto: number; ventana: number[] }> =>
      js(`(() => { const r = document.getElementById('panel').getBoundingClientRect(); return { ancho: Math.round(r.width), alto: Math.round(r.height), ventana: [innerWidth, innerHeight] } })()`)

    // 9a. Redimensionar: arrastrar la esquina libre (arriba a la izquierda) agranda el panel y el orbe no se mueve
    await pulsar('#nueva')
    await esperar(300)
    comprobar('hay tres agarres en el panel abierto', (await contar('.agarre')) === 3)
    comprobar('los agarres no estorban si el panel está cerrado', (await js<string>(`getComputedStyle(document.querySelector('.agarre')).display`)) !== 'none')
    const antes = bounds()
    p.antes = antes
    // Primero se encoge (siempre hay sitio) y luego se vuelve a agrandar: así vale con cualquier tamaño de pantalla.
    await arrastrar('.agarre-xy', 30, 100)
    await esperar(300)
    const pequeno = bounds()
    comprobar('arrastrar hacia dentro encoge el ancho y el alto', casi(pequeno.width, antes.width - 30) && casi(pequeno.height, antes.height - 100), [antes, pequeno])
    await arrastrar('.agarre-xy', -150, -100)
    await esperar(400)
    const grande = bounds()
    p.grande = grande
    comprobar('arrastrar hacia fuera agranda el ancho (sin acumular desvíos)', casi(grande.width, antes.width + 120), [antes.width, grande.width])
    comprobar('y vuelve a crecer el alto', casi(grande.height, antes.height), [antes.height, grande.height])
    comprobar('el orbe no se mueve (esquina inferior derecha fija)', casi(grande.x + grande.width, antes.x + antes.width) && casi(grande.y + grande.height, antes.y + antes.height))
    const m = await medidasPanel()
    p.panelGrande = m
    comprobar('la interfaz sigue el tamaño de la ventana', m.ancho === m.ventana[0] && m.alto === m.ventana[1] - ALTO_EXTRA_ORBE, m)
    comprobar('el tamaño se guarda', JSON.stringify(leerAjustes().panel) === JSON.stringify(panelDeVentana(grande)), leerAjustes().panel)
    await capturar('9a-panel-grande')

    // 9b. Solo el ancho o solo el alto, con los bordes
    const antesX = bounds()
    await arrastrar('.agarre-x', -40, 999)
    await esperar(300)
    comprobar('el borde lateral solo cambia el ancho', casi(bounds().width, antesX.width + 40) && casi(bounds().height, antesX.height), [antesX, bounds()])
    const antesY = bounds()
    await arrastrar('.agarre-y', 999, 60)
    await esperar(300)
    comprobar('el borde superior solo cambia el alto', casi(bounds().height, antesY.height - 60) && casi(bounds().width, antesY.width), [antesY, bounds()])

    // 9c. Hay un mínimo
    await arrastrar('.agarre-xy', 3000, 3000)
    await esperar(300)
    const minimo = bounds()
    p.minimo = minimo
    comprobar('no se encoge más del mínimo', casi(minimo.width, TAM_PANEL_MIN.ancho) && casi(minimo.height, TAM_PANEL_MIN.alto + ALTO_EXTRA_ORBE), minimo)
    await capturar('9c-panel-minimo')

    // 9d. Recuerda el tamaño al cerrar y abrir
    await arrastrar('.agarre-xy', -160, -100)
    await esperar(300)
    const elegido = bounds()
    orbe.establecerExpandido(false)
    await esperar(300)
    orbe.establecerExpandido(true)
    await esperar(500)
    comprobar('al volver a abrir el panel conserva el tamaño', casi(bounds().width, elegido.width) && casi(bounds().height, elegido.height), [elegido, bounds()])
    comprobar('y el orbe colapsado sigue en su sitio', casi(bounds().x + bounds().width, antes.x + antes.width))

    // 9e. El fondo: botón, imagen aplicada, menú, otro fondo, visibilidad y apagarlo
    const imagenDelFondo = (): Promise<string> => js(`getComputedStyle(document.getElementById('fondo')).backgroundImage`)
    comprobar('el botón de fondo aparece al haber imágenes', !(await js<boolean>(`document.getElementById('fondo-boton').hidden`)))
    p.imagen1 = (await imagenDelFondo()).slice(0, 30)
    comprobar('hay una imagen de fondo aplicada', (await imagenDelFondo()).startsWith('url("data:image/jpeg;base64,'), p.imagen1)
    comprobar('el panel lo sabe (para dar más contraste)', await existe('#panel.con-fondo'))
    p.opacidad = await js<string>(`getComputedStyle(document.getElementById('fondo')).opacity`)
    comprobar('empieza con la visibilidad por defecto', Math.abs(Number(p.opacidad) - 0.5) < 0.05, p.opacidad)

    await escribirYEnviar('Hola, ¿qué puedes hacer por mí?')
    await esperar(500)
    await esperarFin(15_000)
    await esperar(400)
    await capturar('9e-con-fondo')

    await pulsar('#fondo-boton')
    comprobar('se abre el menú del fondo', await esperarSelector('#fondo-menu:not([hidden]) .boton-memoria', 2000))
    p.menu = await textoDe('#fondo-menu')
    comprobar('el menú dice cuántas imágenes hay', /3 imágenes/.test(String(p.menu)), p.menu)
    await capturar('9f-menu-fondo')

    const antesDeCambiar = await imagenDelFondo()
    await pulsar('#fondo-menu .boton-memoria')
    await esperar(600)
    const despues = await imagenDelFondo()
    comprobar('«Otro fondo» cambia la imagen', despues !== antesDeCambiar && despues.startsWith('url("data:image/jpeg'))

    await js(`(() => { const r = document.querySelector('#fondo-menu input[type=range]'); r.value = '80'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await esperar(500)
    p.opacidad2 = await js<string>(`getComputedStyle(document.getElementById('fondo')).opacity`)
    comprobar('el control de visibilidad cambia lo que se ve', Math.abs(Number(p.opacidad2) - 0.8) < 0.05, p.opacidad2)
    comprobar('y la imagen no se vuelve a cargar', (await imagenDelFondo()) === despues)
    await capturar('9g-visibilidad-alta')

    await js(`(() => { const c = document.querySelector('#fondo-menu input[type=checkbox]'); c.click() })()`)
    await esperar(500)
    comprobar('apagar el fondo lo quita', !(await existe('#panel.con-fondo')) && (await imagenDelFondo()) === 'none')
    await js(`(() => { const c = document.querySelector('#fondo-menu input[type=checkbox]'); c.click() })()`)
    await esperar(700)
    comprobar('encenderlo lo devuelve', (await existe('#panel.con-fondo')) && (await imagenDelFondo()).startsWith('url("data:image/jpeg'))

    // Esc cierra el menú sin cerrar el panel
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await esperar(250)
    comprobar('Esc cierra el menú', await js<boolean>(`document.getElementById('fondo-menu').hidden`))
    comprobar('y el panel sigue abierto', orbe.estaExpandido)
    // Un clic fuera también lo cierra
    await pulsar('#fondo-boton')
    await esperarSelector('#fondo-menu:not([hidden])', 2000)
    await js(`document.getElementById('mensajes').click()`)
    await esperar(250)
    comprobar('un clic fuera cierra el menú', await js<boolean>(`document.getElementById('fondo-menu').hidden`))
  }

  /** Voz (leer las respuestas) y dictado por micrófono (con el micrófono falso de Chromium y una transcripción de mentira). */
  /** La bandeja no se crea en la prueba, pero su orden «nueva conversación» llega a la interfaz por este canal. */
  const pasosBandeja = async (): Promise<void> => {
    const v: Record<string, unknown> = (informe.bandeja = {})
    await pulsar('#nueva')
    await esperar(300)
    await escribirYEnviar('Hola desde la bandeja')
    await esperarFin(15_000)
    comprobar('hay mensajes antes de la orden de la bandeja', (await contar('.msg')) >= 2)
    wc.send(CANALES.appOrden, 'nueva-conversacion')
    await esperar(600)
    v.mensajes = await contar('.msg')
    comprobar('la orden «nueva conversación» de la bandeja limpia el chat', v.mensajes === 0, v.mensajes)
  }

  /** Configuración (proveedor, claves, dictado y voz), botón de fijar y botón de cerrar. */
  const pasosAjustes = async (): Promise<void> => {
    const v: Record<string, unknown> = (informe.ajustes = {})
    const poner = (selector: string, valor: string): Promise<unknown> =>
      js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(valor)}; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })()`)
    const archivoEnv = join(app.getPath('userData'), '.env')

    await pulsar('#ajustes-boton')
    await esperarSelector('#ajustes:not([hidden]) .ajuste-seccion', 3000)
    comprobar('la configuración se abre y esconde el chat', (await js<boolean>(`document.querySelector('.panel-cuerpo').hidden`)) && (await existe('#ajustes-boton[aria-pressed="true"]')))
    comprobar('tiene las tres secciones', (await textosDe('#ajustes .ajuste-titulo')).length === 3, await textosDe('#ajustes .ajuste-titulo'))
    comprobar('el menú de la configuración ofrece Claude (CLI y API) y otras IA', (await textoDe('#ajustes select[aria-label="Quién responde"]')).includes('Otra IA compatible con OpenAI'))
    await capturar('11a-ajustes')

    // Cambiar a otra IA con el preajuste de Groq y poner una clave
    await poner('#ajustes select[aria-label="Quién responde"]', 'openai')
    await esperar(150)
    await poner('#ajustes select[aria-label="Servicio"]', 'groq')
    await esperar(150)
    v.url = await js<string>(`document.querySelector('#ajustes input[aria-label="Dirección del servicio"]').value`)
    v.modelo = await js<string>(`document.querySelector('#ajustes input[aria-label="Modelo"]').value`)
    comprobar('el preajuste de Groq rellena la dirección y el modelo', v.url === 'https://api.groq.com/openai/v1' && v.modelo === 'llama-3.3-70b-versatile', v)
    await poner('#ajustes input[aria-label="Clave del servicio"]', 'gsk_clave-de-prueba')
    const claveVisible = await js<boolean>(`document.querySelector('#ajustes input[aria-label="Clave del servicio"]').type === 'password'`)
    comprobar('la clave se escribe oculta', claveVisible)

    // Dictado con Groq y voz con un servidor local
    await poner('#ajustes select[aria-label="Servicio de dictado"]', 'groq')
    await esperar(150)
    await poner('#ajustes select[aria-label="Servicio de voz"]', 'kokoro')
    await esperar(150)
    v.voz = await js<string>(`document.querySelector('#ajustes input[aria-label="Voz"]').value`)
    comprobar('el preajuste de la voz local pone una voz en español', v.voz === 'em_alex', v.voz)
    await capturar('11b-ajustes-rellenos')

    // Guardar: el .env recibe los cambios y la clave nunca vuelve a la pantalla
    await js(`document.querySelector('#ajustes .boton-memoria.primario').click()`)
    await esperar(800)
    v.mensaje = await textoDe('#ajustes .memoria-cuerpo')
    comprobar('avisa de que se guarda y reinicia', String(v.mensaje).includes('Orbe se está reiniciando'), v.mensaje)
    const env = readFileSync(archivoEnv, 'utf8')
    v.env = env.replace(/^(ORBE_[A-Z_]*KEY)=.+$/gm, '$1=<oculta>')
    comprobar('el .env tiene el proveedor, el modelo y la dirección', env.includes('ORBE_PROVEEDOR=openai') && env.includes('ORBE_MODELO=llama-3.3-70b-versatile') && env.includes('ORBE_OPENAI_URL=https://api.groq.com/openai/v1'), v.env)
    comprobar('y la clave', /ORBE_OPENAI_KEY=gsk_clave-de-prueba/.test(env))
    comprobar('y el dictado y la voz', /ORBE_STT_MODELO=whisper-large-v3-turbo/.test(env) && /ORBE_TTS_VOZ=em_alex/.test(env), v.env)
    comprobar('la clave no queda en el DOM como texto visible', !(await js<string>(`document.getElementById('ajustes').innerText`)).includes('gsk_clave-de-prueba'))
    comprobar('hay un botón para cerrar Orbe por completo', /Cerrar Orbe por completo/.test(await textoDe('#ajustes')))
    await capturar('11c-ajustes-guardado')

    // Esc vuelve al chat sin cerrar el panel
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await esperar(300)
    comprobar('Esc cierra la configuración y no el panel', !(await js<boolean>(`document.querySelector('.panel-cuerpo').hidden`)) && orbe.estaExpandido)

    // Fijar el panel por encima de las demás ventanas
    comprobar('arranca fijado', (await existe('#fijar-boton[aria-pressed="true"]')) && orbe.ventana.isAlwaysOnTop())
    await pulsar('#fijar-boton')
    await esperar(300)
    comprobar('soltarlo lo baja del nivel de siempre-encima', (await existe('#fijar-boton[aria-pressed="false"]')) && !orbe.ventana.isAlwaysOnTop())
    await capturar('11d-suelto')
    await pulsar('#fijar-boton')
    await esperar(300)
    comprobar('fijarlo otra vez lo sube', (await existe('#fijar-boton[aria-pressed="true"]')) && orbe.ventana.isAlwaysOnTop())

    // El botón de cerrar solo recoge el panel
    await pulsar('#cerrar-boton')
    await esperar(500)
    comprobar('cerrar recoge el panel al orbe', !orbe.estaExpandido && orbe.estaVisible)
    orbe.establecerExpandido(true)
    await esperar(500)
  }

  const pasosVoz = async (): Promise<void> => {
    const v: Record<string, unknown> = {}
    informe.voz = v
    const escribir = (texto: string): Promise<unknown> =>
      js(`(() => { const t = document.getElementById('entrada'); t.value = ${JSON.stringify(texto)}; t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    const campo = (): Promise<string> => js(`document.getElementById('entrada').value`)
    const estadoLinea = (): Promise<string> => js(`document.getElementById('estado-linea').hidden ? '' : document.getElementById('estado-linea').textContent`)
    const pulsarEscape = (): Promise<unknown> => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    const casilla = (n: number): string => `#voz-menu .memoria-opcion:nth-of-type(${n}) input`

    // 10a. El menú de voz y su convivencia con el del fondo
    await pulsar('#nueva')
    await esperar(400)
    comprobar('hay botón de voz y de micrófono', (await existe('#voz-boton')) && (await existe('#microfono')))
    await pulsar('#voz-boton')
    comprobar('se abre el menú de voz', await esperarSelector('#voz-menu:not([hidden]) .voz-selector', 2000))
    v.menu = await textoDe('#voz-menu')
    v.voces = await js<number>(`speechSynthesis.getVoices().length`)
    comprobar('el menú explica el estado del dictado', /Dictado listo \(whisper-1, idioma es\)/.test(String(v.menu)), v.menu)
    comprobar('y ofrece leer en voz alta, probar y parar', /Leer las respuestas en voz alta/.test(String(v.menu)) && /Probar la voz/.test(String(v.menu)) && /Parar/.test(String(v.menu)))
    await capturar('10a-menu-voz')
    await pulsar('#fondo-boton')
    await esperar(300)
    comprobar('abrir el del fondo cierra el de voz', (await js<boolean>(`document.getElementById('voz-menu').hidden`)) && !(await js<boolean>(`document.getElementById('fondo-menu').hidden`)))
    await pulsarEscape()
    await esperar(200)

    // 10b. Dictar: un clic graba (el orbe «escucha»), otro clic termina y el texto aparece en el campo
    await pulsar('#microfono')
    comprobar('empieza a grabar', await esperarSelector('#microfono.grabando', 4000))
    await esperar(1500)
    v.estadoGrabando = await estadoLinea()
    v.orbeGrabando = await estadoOrbe()
    comprobar('la línea de estado cuenta el tiempo y explica cómo terminar', /^Grabando… 0:0\d · pulsa el micrófono para terminar/.test(String(v.estadoGrabando)), v.estadoGrabando)
    comprobar('el orbe pasa a «escuchando»', v.orbeGrabando === 'escuchando', v.orbeGrabando)
    await capturar('10b-grabando')
    await pulsar('#microfono')
    comprobar('al terminar, el texto dictado aparece en el campo', await (async () => {
      const limite = Date.now() + 8000
      while (Date.now() < limite) {
        if ((await campo()).includes('Texto dictado de prueba')) return true
        await esperar(150)
      }
      return false
    })(), await campo())
    comprobar('ya no graba y la línea de estado se limpia', !(await existe('#microfono.grabando')) && (await estadoLinea()) === '', await estadoLinea())
    comprobar('el orbe vuelve a reposo', (await estadoOrbe()) === 'reposo')
    await capturar('10c-dictado')

    // 10d. Dictar sobre lo que ya hay escrito lo añade con un espacio
    await escribir('Hola,')
    await pulsar('#microfono')
    await esperarSelector('#microfono.grabando', 4000)
    await esperar(1200)
    await pulsar('#microfono')
    await esperar(2500)
    comprobar('lo dictado se añade a lo escrito', (await campo()) === 'Hola, Texto dictado de prueba', await campo())
    await escribir('')

    // 10e. Esc cancela la grabación sin transcribir nada
    await pulsar('#microfono')
    await esperarSelector('#microfono.grabando', 4000)
    await esperar(800)
    await pulsarEscape()
    await esperar(1500)
    comprobar(
      'Esc descarta la grabación',
      !(await existe('#microfono.grabando')) && (await campo()) === '',
      { grabando: await existe('#microfono.grabando'), campo: await campo(), estado: await estadoLinea(), botonDeshabilitado: await js(`document.getElementById('microfono').disabled`) }
    )
    comprobar('y el panel sigue abierto', orbe.estaExpandido)

    // 10f. Con «enviar al terminar de dictar», el mensaje sale solo
    await pulsar('#voz-boton')
    await esperarSelector('#voz-menu:not([hidden])', 2000)
    await js(`document.querySelector('#voz-menu .memoria-opcion:last-of-type input').click()`)
    await esperar(200)
    await js(`document.body.click()`)
    await nuevaConversacionHumo()
    await pulsar('#microfono')
    await esperarSelector('#microfono.grabando', 4000)
    await esperar(1200)
    await pulsar('#microfono')
    comprobar('el mensaje dictado se envía solo', await esperarSelector('.msg.usuario', 8000))
    v.enviado = await textoDe('.msg.usuario .contenido-plano')
    comprobar('con el texto dictado', v.enviado === 'Texto dictado de prueba', v.enviado)
    await esperarFin(15_000)
    await esperar(400)
    // Se vuelve a dejar apagado para el resto de la prueba.
    await pulsar('#voz-boton')
    await esperarSelector('#voz-menu:not([hidden])', 2000)
    await js(`document.querySelector('#voz-menu .memoria-opcion:last-of-type input').click()`)
    await js(`document.body.click()`)

    // 10g. Leer las respuestas: frase a frase, saltándose el código, y Esc la corta
    await nuevaConversacionHumo()
    await js(`(() => {
      window.__dicho = [];
      const original = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = (u) => { window.__dicho.push(u.text); u.volume = 0; original(u) }; // en silencio: la prueba no debe sonar
    })()`)
    await pulsar('#voz-boton')
    await esperarSelector('#voz-menu:not([hidden])', 2000)
    await js(`document.querySelector('#voz-menu .memoria-opcion:first-of-type input').click()`)
    await esperar(200)
    comprobar('el botón de voz se marca como activo', await existe('#voz-boton.activo'))
    await js(`document.body.click()`)
    await escribirYEnviar('Hola, ¿qué puedes hacer por mí?')
    await esperarFin(15_000)
    await esperar(1200)
    v.dicho = await js<string[]>(`window.__dicho`)
    comprobar('se leyó la respuesta por frases', (v.dicho as string[]).includes('Claro, esto es una respuesta de demostración para ver cómo se pinta el chat.'), v.dicho)
    comprobar('sin leer el código (solo avisa de que hay)', (v.dicho as string[]).some((f) => f.startsWith('Hay un bloque de código')) && !(v.dicho as string[]).some((f) => f.includes('function')), v.dicho)
    comprobar('ni los símbolos de Markdown', !(v.dicho as string[]).some((f) => /[*`#]|\]\(/.test(f)), v.dicho)
    comprobar('ni la dirección web', !(v.dicho as string[]).some((f) => f.includes('example.com')), v.dicho)
    await pulsarEscape()
    await esperar(300)
    comprobar('Esc corta la voz y no cierra el panel', !(await js<boolean>(`speechSynthesis.speaking`)) && orbe.estaExpandido)

    // Y se deja apagada.
    await pulsar('#voz-boton')
    await esperarSelector('#voz-menu:not([hidden])', 2000)
    await js(`document.querySelector('#voz-menu .memoria-opcion:first-of-type input').click()`)
    await esperar(200)
    comprobar('apagarla la quita del botón', !(await existe('#voz-boton.activo')))
    await js(`document.body.click()`)

    // 10h. «Estilo Jarvis»: por defecto con las voces de Windows (voz masculina, grave y pausada); la neuronal, si se elige
    await nuevaConversacionHumo()
    await js(`(() => {
      window.__reproducidos = 0;
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { window.__reproducidos++; return play.call(this) };
    })()`)
    const dichosAntes = (await js<string[]>(`window.__dicho`)).length
    await pulsar('#voz-boton')
    await esperarSelector('#voz-menu:not([hidden]) .boton-memoria.primario', 2000)
    comprobar('el menú ofrece el estilo Jarvis', /Estilo Jarvis/.test(await textoDe('#voz-menu')))
    comprobar('y la voz neuronal como motor', /Voz neuronal «onyx»/.test(await textoDe('#voz-menu')))
    comprobar('el motor por defecto son las voces de Windows', (await js<string>(`document.querySelector('#voz-menu select[aria-label="Motor de voz"]').value`)) === 'windows')
    await js(`document.querySelector('#voz-menu .boton-memoria.primario').click()`)
    await esperar(600)
    v.prefsJarvis = await js<string>(`localStorage.getItem('orbe.voz')`)
    const prefsJarvis = JSON.parse(String(v.prefsJarvis)) as { activa: boolean; voz: string | null; velocidad: number; tono: number; motor: string }
    comprobar('activa la lectura con las voces de Windows', prefsJarvis.activa === true && prefsJarvis.motor === 'windows', prefsJarvis)
    comprobar('grave y pausado', prefsJarvis.tono === 0.7 && prefsJarvis.velocidad === 0.9, prefsJarvis)
    if ((v.voces as number) > 0) comprobar('elige una voz masculina de Windows', /raul|pablo|jorge|david|mark/i.test(String(prefsJarvis.voz)), prefsJarvis.voz)
    comprobar('el menú deja elegir la voz de Windows', !(await js<boolean>(`document.querySelector('#voz-menu select[aria-label="Voz de Windows"]').disabled`)))
    comprobar('pulsar «Estilo Jarvis» no cierra el menú', !(await js<boolean>(`document.getElementById('voz-menu').hidden`)))
    await capturar('10h-jarvis')
    comprobar('probar la voz (al elegir el estilo) habló con Windows y no con la neuronal', (await js<string[]>(`window.__dicho`)).length > dichosAntes && (await js<number>(`window.__reproducidos`)) === 0)

    // Y si se elige la voz neuronal, esa es la que lee
    await js(`(() => { const s = document.querySelector('#voz-menu select[aria-label="Motor de voz"]'); s.value = 'neuronal'; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
    await esperar(300)
    comprobar('el menú muestra la voz neuronal elegida y deshabilita lo de Windows', (await js<boolean>(`document.querySelector('#voz-menu select[aria-label="Voz de Windows"]').disabled`)))
    await js(`document.body.click()`)
    const antesAudio = await js<number>(`window.__reproducidos`)
    const dichosNeuronal = (await js<string[]>(`window.__dicho`)).length
    await escribirYEnviar('Hola, ¿qué puedes hacer por mí?')
    await esperarFin(15_000)
    await esperar(1500)
    v.reproducidos = (await js<number>(`window.__reproducidos`)) - antesAudio
    comprobar('la respuesta se lee con la voz neuronal, frase a frase', (v.reproducidos as number) >= 5, v.reproducidos)
    comprobar('sin usar la voz de Windows', (await js<string[]>(`window.__dicho`)).length === dichosNeuronal)

    // Se deja todo como estaba.
    await pulsar('#voz-boton')
    await esperarSelector('#voz-menu:not([hidden])', 2000)
    await js(`document.querySelector('#voz-menu .memoria-opcion:first-of-type input').click()`)
    await esperar(200)
    await js(`document.body.click()`)
    comprobar('queda apagada', !(await existe('#voz-boton.activo')))

    // 10i. El botón de copiar sigue funcionando con los permisos restringidos (el portapapeles exige que la ventana tenga el foco)
    app.focus({ steal: true })
    orbe.ventana.focus()
    await esperar(400)
    const copiado = await wc.executeJavaScript(
      `(async () => { const b = document.querySelector('.msg.asistente .boton-copiar'); b.click(); await new Promise((r) => setTimeout(r, 400)); return b.textContent })()`,
      true
    )
    v.portapapeles = await wc.executeJavaScript(
      `(async () => { try { await navigator.clipboard.writeText('x'); return 'ok' } catch (e) { return e.name + ': ' + e.message } })()`,
      true
    )
    comprobar('copiar al portapapeles sigue permitido', copiado === 'Copiado', [copiado, v.portapapeles])
  }

  /** «Nueva conversación» y un respiro, para empezar un paso con la pantalla limpia. */
  const nuevaConversacionHumo = async (): Promise<void> => {
    await pulsar('#nueva')
    await esperar(400)
  }

  /**
   * Modo agente: líneas de acción, estado «actuando», tarjeta de permiso y Detener, ensayados con el proveedor de
   * demostración (que simula acciones: no se usa ninguna herramienta de verdad ni se toca nada del equipo).
   */
  const pasosAgente = async (): Promise<void> => {
    const a: Record<string, unknown> = {}
    informe.agente = a
    const nuevaConversacion = async (): Promise<void> => {
      await pulsar('#nueva')
      await esperar(400)
    }
    const estadosAcciones = (): Promise<string[]> => js(`[...document.querySelectorAll('.msg.asistente .accion')].map((e) => e.dataset.estado)`)
    const tarjetaVisible = (): Promise<boolean> => existe('#confirmacion:not([hidden]) .confirmacion-permitir')
    const detenerVisible = (selector: string): Promise<boolean> =>
      js(`(() => { const b = document.querySelector(${JSON.stringify(selector)}); return !!b && !b.hidden && getComputedStyle(b).display !== 'none' })()`)

    // 11a. Una tarea con acciones: búsqueda, tarjeta de permiso (se permite) y más texto
    await nuevaConversacion()
    await escribirYEnviar('/acciones')
    a.hayAccionEnCurso = await esperarSelector('.msg.asistente .accion[data-estado="en_curso"]', 6000)
    comprobar('aparece la línea de la acción en curso', a.hayAccionEnCurso === true)
    await esperar(300)
    a.orbeActuando = await estadoOrbe()
    comprobar('el orbe pasa a «actuando» mientras la acción corre', a.orbeActuando === 'actuando', a.orbeActuando)
    a.detenerTarea = await detenerVisible('#detener-accion')
    comprobar('«Detener la tarea» está a la vista mientras el agente actúa', a.detenerTarea === true)
    await capturar('11a-accion')
    a.tarjeta = await esperarSelector('#confirmacion:not([hidden]) .confirmacion-permitir', 6000)
    comprobar('aparece la tarjeta de permiso del agente', a.tarjeta === true)
    a.tituloTarjeta = await textoDe('#confirmacion .confirmacion-titulo')
    comprobar('la tarjeta dice la acción exacta', String(a.tituloTarjeta).includes('Enviar el formulario de contacto'), a.tituloTarjeta)
    comprobar('la tarjeta no roba el foco al campo de texto', await js<boolean>(`document.activeElement?.closest('#confirmacion') === null`))
    await capturar('11a-tarjeta')
    await pulsar('#confirmacion .confirmacion-permitir')
    comprobar('la tarea termina tras permitirla', await esperarFin(8000))
    await esperar(1300)
    a.estados = await estadosAcciones()
    a.tramos = (await textosDe('.msg.asistente .contenido')).map((t) => t.trim())
    comprobar('las dos acciones quedan en el chat, hechas', mismos(a.estados, ['ok', 'ok']), a.estados)
    comprobar(
      'el texto de antes y de después va en tramos separados',
      mismos(a.tramos, ['Voy a buscarlo.', 'Listo: formulario enviado.']),
      a.tramos
    )
    comprobar('la tarjeta se cierra', !(await tarjetaVisible()))
    comprobar('«Detener la tarea» desaparece al terminar', !(await detenerVisible('#detener-accion')))
    a.orbeFinal = await estadoOrbe()
    comprobar('el orbe vuelve a reposo', a.orbeFinal === 'reposo', a.orbeFinal)
    await capturar('11a-final')
    // El detalle se despliega con sus parámetros y su resultado.
    await pulsar('.msg.asistente .accion .accion-cabecera')
    a.detalle = await textoDe('.msg.asistente .accion .accion-detalle')
    comprobar('el detalle de la acción trae parámetros y resultado', String(a.detalle).includes('Parámetros') && String(a.detalle).includes('3 resultados'), a.detalle)

    // 11b. El usuario no permite la acción: queda como «no permitida» y el agente lo acepta
    await nuevaConversacion()
    await escribirYEnviar('/acciones')
    comprobar('la tarjeta aparece otra vez', await esperarSelector('#confirmacion:not([hidden]) .confirmacion-cancelar', 8000))
    await pulsar('#confirmacion .confirmacion-cancelar')
    comprobar('la tarea termina tras cancelar', await esperarFin(8000))
    await esperar(500)
    a.estadosCancelada = await estadosAcciones()
    comprobar('la segunda acción queda como «no permitida»', mismos(a.estadosCancelada, ['ok', 'denegada']), a.estadosCancelada)
    comprobar('el agente acepta la negativa', String(await textosDe('.msg.asistente .contenido').then((t) => t.at(-1))).includes('No envié'))

    // 11c. Detener con el botón de la tarea
    await nuevaConversacion()
    await escribirYEnviar('/colgada')
    comprobar('la acción colgada está en curso', await esperarSelector('.msg.asistente .accion[data-estado="en_curso"]', 6000))
    await esperar(400)
    await capturar('11c-colgada')
    await pulsar('#detener-accion')
    comprobar('Detener corta la tarea', await esperarFin(4000))
    await esperar(500)
    a.estadosDetenida = await estadosAcciones()
    comprobar('la acción queda como detenida', mismos(a.estadosDetenida, ['cancelada']), a.estadosDetenida)
    comprobar('la burbuja avisa de que la tarea se detuvo', (await textoDe('.msg.asistente .nota')).includes('Tarea detenida'))
    await capturar('11c-detenida')

    // 11d. Esc también detiene al agente (en lugar de plegar el panel)
    await nuevaConversacion()
    await escribirYEnviar('/colgada')
    comprobar('la acción colgada empieza de nuevo', await esperarSelector('.msg.asistente .accion[data-estado="en_curso"]', 6000))
    await esperar(300)
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    comprobar('Esc detiene la tarea', await esperarFin(4000))
    comprobar('con Esc el panel sigue abierto', orbe.estaExpandido)

    // 11e. Con el panel plegado, el orbe lleva su propio «Detener»
    await nuevaConversacion()
    await escribirYEnviar('/colgada')
    comprobar('la acción colgada empieza otra vez', await esperarSelector('.msg.asistente .accion[data-estado="en_curso"]', 6000))
    orbe.establecerExpandido(false)
    await esperar(600)
    a.detenerOrbe = await detenerVisible('#detener-orbe')
    comprobar('el orbe plegado muestra su «Detener»', a.detenerOrbe === true)
    await capturar('11e-plegado')
    await pulsar('#detener-orbe')
    comprobar('el «Detener» del orbe corta la tarea', await esperarFin(4000))
    await esperar(400)
    comprobar('el «Detener» del orbe se esconde al terminar', !(await detenerVisible('#detener-orbe')))
    orbe.establecerExpandido(true)
    await esperar(600)
    await nuevaConversacion()
  }

  /** El marcador de potencia de la cabecera: se abre, se mueve, se guarda y se cierra con Esc. */
  const pasosPotencia = async (): Promise<void> => {
    const p: Record<string, unknown> = {}
    informe.potencia = p
    const menuAbierto = (): Promise<boolean> => existe('#potencia-menu:not([hidden])')
    /** Mueve el deslizador como lo haría una persona: arrastra (input) y suelta (change). */
    const moverA = (posicion: number): Promise<unknown> =>
      js(`(() => {
        const r = document.querySelector('#potencia-menu input[type=range]');
        r.value = ${posicion};
        r.dispatchEvent(new Event('input', { bubbles: true }));
        r.dispatchEvent(new Event('change', { bubbles: true }));
      })()`)
    const aguja = (): Promise<string> => js(`document.getElementById('potencia-boton').style.getPropertyValue('--aguja')`)

    p.nivelInicial = await js(`document.getElementById('potencia-boton').dataset.nivel`)
    comprobar('el marcador empieza en «medium»', p.nivelInicial === 'medium', p.nivelInicial)
    await pulsar('#potencia-boton')
    comprobar('el marcador abre su menú', await esperarSelector('#potencia-menu:not([hidden])', 3000))
    p.menuInicial = await textoDe('#potencia-menu')
    comprobar('el menú dice el nivel y explica cuándo se aplica', /Equilibrado/.test(String(p.menuInicial)) && /próximo mensaje/.test(String(p.menuInicial)), p.menuInicial)
    comprobar('con el nivel medio no avisa del gasto', await js<boolean>(`document.querySelector('#potencia-menu .potencia-costo').hidden`))
    await capturar('12a-potencia')

    await moverA(4)
    await esperar(300)
    p.nivelMax = await js(`document.getElementById('potencia-boton').dataset.nivel`)
    p.agujaMax = await aguja()
    p.guardado = leerAjustes().esfuerzo
    p.menuMax = await textoDe('#potencia-menu')
    comprobar('al llevarlo al máximo el botón lo refleja', p.nivelMax === 'max', p.nivelMax)
    comprobar('la aguja gira hasta el final', p.agujaMax === '70deg', p.agujaMax)
    comprobar('el nivel se guarda para la próxima vez', p.guardado === 'max', p.guardado)
    comprobar('el menú explica el nivel y avisa del gasto', /Máximo/.test(String(p.menuMax)) && /más gasto/.test(String(p.menuMax)), p.menuMax)
    comprobar('el aviso de gasto se ve con potencia alta', !(await js<boolean>(`document.querySelector('#potencia-menu .potencia-costo').hidden`)))
    await capturar('12b-maximo')

    await moverA(0)
    await esperar(300)
    p.nivelBajo = await js(`document.getElementById('potencia-boton').dataset.nivel`)
    p.agujaBaja = await aguja()
    comprobar('y al bajarlo vuelve a «low» con la aguja a la izquierda', p.nivelBajo === 'low' && p.agujaBaja === '-70deg', [p.nivelBajo, p.agujaBaja])
    comprobar('el título del botón dice el nivel', (await js<string>(`document.getElementById('potencia-boton').title`)).includes('Rápido'))

    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await esperar(200)
    comprobar('Esc cierra el menú sin cerrar el panel', !(await menuAbierto()) && orbe.estaExpandido)

    // Reabrir enseña lo guardado, y abrir el menú de voz cierra el de potencia (comparten sitio).
    await pulsar('#potencia-boton')
    comprobar('al reabrir enseña el nivel guardado', (await textoDe('#potencia-menu')).includes('Rápido'))
    await pulsar('#voz-boton')
    await esperar(300)
    comprobar('abrir otro menú cierra el de potencia', !(await menuAbierto()))
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    // Se deja en el punto medio, como empezó.
    await pulsar('#potencia-boton')
    await moverA(1)
    await esperar(300)
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
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
      for (const estado of ['reposo', 'leyendo', 'pensando', 'respondiendo', 'actuando']) {
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
      if (extras) {
        // La primera vez, Orbe avisa de que ha traído la memoria de Claude (una sola vez).
        informe.bienvenida = await textoDe('#mensajes .aviso')
        comprobar('avisa de la memoria cargada de Claude', String(informe.bienvenida).includes('He cargado 3 notas'), informe.bienvenida)
      }

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

      // 6. Lectura de pantalla (fase 3) y 7. memoria
      if (extras) {
        await pasosPantalla(extras)
        await pasosMemoria(extras)
        await pasosCaptura(extras)
        await pasosPanel()
        await pasosAgente()
        await pasosPotencia()
        await pasosVoz()
        await pasosBandeja()
        await pasosAjustes()
      }

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
