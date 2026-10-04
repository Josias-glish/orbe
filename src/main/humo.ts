import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
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
    comprobar('arrastrar hacia dentro encoge el ancho y el alto', pequeno.width === antes.width - 30 && pequeno.height === antes.height - 100, [antes, pequeno])
    await arrastrar('.agarre-xy', -150, -100)
    await esperar(400)
    const grande = bounds()
    p.grande = grande
    comprobar('arrastrar hacia fuera agranda el ancho', grande.width === antes.width + 120, [antes.width, grande.width])
    comprobar('y vuelve a crecer el alto', grande.height === antes.height, [antes.height, grande.height])
    comprobar('el orbe no se mueve (esquina inferior derecha fija)', grande.x + grande.width === antes.x + antes.width && grande.y + grande.height === antes.y + antes.height)
    const m = await medidasPanel()
    p.panelGrande = m
    comprobar('la interfaz sigue el tamaño de la ventana', m.ancho === m.ventana[0] && m.alto === m.ventana[1] - ALTO_EXTRA_ORBE, m)
    comprobar('el tamaño se guarda', JSON.stringify(leerAjustes().panel) === JSON.stringify(panelDeVentana(grande)), leerAjustes().panel)
    await capturar('9a-panel-grande')

    // 9b. Solo el ancho o solo el alto, con los bordes
    const antesX = bounds()
    await arrastrar('.agarre-x', -40, 999)
    await esperar(300)
    comprobar('el borde lateral solo cambia el ancho', bounds().width === antesX.width + 40 && bounds().height === antesX.height, [antesX, bounds()])
    const antesY = bounds()
    await arrastrar('.agarre-y', 999, 60)
    await esperar(300)
    comprobar('el borde superior solo cambia el alto', bounds().height === antesY.height - 60 && bounds().width === antesY.width, [antesY, bounds()])

    // 9c. Hay un mínimo
    await arrastrar('.agarre-xy', 3000, 3000)
    await esperar(300)
    const minimo = bounds()
    p.minimo = minimo
    comprobar('no se encoge más del mínimo', minimo.width === TAM_PANEL_MIN.ancho && minimo.height === TAM_PANEL_MIN.alto + ALTO_EXTRA_ORBE, minimo)
    await capturar('9c-panel-minimo')

    // 9d. Recuerda el tamaño al cerrar y abrir
    await arrastrar('.agarre-xy', -160, -100)
    await esperar(300)
    const elegido = bounds()
    orbe.establecerExpandido(false)
    await esperar(300)
    orbe.establecerExpandido(true)
    await esperar(500)
    comprobar('al volver a abrir el panel conserva el tamaño', bounds().width === elegido.width && bounds().height === elegido.height, [elegido, bounds()])
    comprobar('y el orbe colapsado sigue en su sitio', bounds().x + bounds().width === antes.x + antes.width)

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
