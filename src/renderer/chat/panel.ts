import type {
  OrigenTextoImagen,
  AccionVista,
  ClaveParte,
  ErrorOrbe,
  EventoChat,
  EventoPantalla,
  InfoChat,
  LecturaPantalla,
  ResultadoEnvio
} from '../../shared/tipos'
import { esPreguntaVisual } from '../../shared/visual'
import { buscarProtocolo, frases, parteDeSituacion, perfilDe, pideParte, pideProtocolo, type PerfilIdentidad } from '../../shared/identidad'
import { datosDelParte } from '../identidad/parte'
import { textoPlano } from '../tareas/formato'
import { expresionDeTexto } from '../../shared/expresiones'
import { gestoDeExpresion } from '../personaje/gestos'
import { EntradaTeclado } from '../entrada/entrada'
import { VistaAjustes } from '../ajustes/vista-ajustes'
import { VistaMemoria } from '../memoria/vista-memoria'
import { VistaUso } from '../uso/vista-uso'
import { VistaContenido } from '../contenido/vista-contenido'
import { VistaMetricas } from '../metricas/vista-metricas'
import { VistaTareas } from '../tareas/vista-tareas'
import type { Avatar } from '../personaje/avatar'
import { Dictado, type EstadoDictado } from '../voz/dictado'
import { LectorVoz, type Sintesis } from '../voz/lector'
import { ReproductorAudio } from '../voz/reproductor'
import { MenuVoz } from '../voz/menu-voz'
import { ConfirmacionCaptura, SugerenciaCaptura } from './captura-ui'
import { MenuTextoImagen, type ModoImagen } from './ocr-ui'
import { ConfirmacionAccion } from './confirmacion-accion'
import { BarraContexto } from './contexto-ui'
import { ListaMensajes, RespuestaEnCurso } from './mensajes'
import { MenuPotencia } from './menu-potencia'

interface TurnoEnCurso {
  id: string
  texto: string
  respuesta: RespuestaEnCurso
  /** Ya llegó texto del tramo actual (cada acción del agente abre un tramo nuevo). */
  recibioTexto: boolean
  /** El agente ya hizo alguna acción en este turno: hace falta un Detener bien visible. */
  conAcciones: boolean
  /** El texto de la respuesta (hasta 4000 caracteres), para elegir la cara al terminar. */
  acumulado: string
}

/** Pausa antes de volver a «reposo» al terminar, para que las ondas del orbe se apaguen con suavidad. */
const RETRASO_REPOSO_MS = 450
/** El destello de «leyendo» dura lo justo para verse aunque la lectura sea instantánea. */
const LECTURA_MIN_MS = 1100

/** Panel de chat: une la lista de mensajes, el campo de entrada, el orbe y los servicios de chat y pantalla. */
export class PanelChat {
  private readonly lista: ListaMensajes
  private readonly entrada: EntradaTeclado
  private readonly barra: BarraContexto
  private readonly botonEnviar: HTMLButtonElement
  private readonly botonLeer: HTMLButtonElement
  private readonly botonMemoria: HTMLButtonElement
  private readonly botonCapturar: HTMLButtonElement
  private readonly confirmacion: ConfirmacionCaptura
  private readonly confirmacionAccion: ConfirmacionAccion
  private readonly botonDetenerAccion: HTMLButtonElement
  private readonly botonDetenerOrbe: HTMLButtonElement
  private readonly sugerencia: SugerenciaCaptura
  private capturando = false
  private readonly botonTextoImagen: HTMLButtonElement
  private readonly menuTextoImagen: MenuTextoImagen
  private reconociendo = false
  private readonly botonMicro: HTMLButtonElement
  private readonly lector: LectorVoz
  private readonly menuVoz: MenuVoz
  private readonly menuPotencia: MenuPotencia
  private readonly dictado: Dictado
  /** La línea de estado muestra ahora «Grabando…» o «Transcribiendo…» (y no un error que no debe borrarse). */
  private mostrandoDictado = false
  /** El usuario cerró la sugerencia de captura: no se vuelve a ofrecer hasta su próximo mensaje. */
  private sugerenciaDescartada = false
  private readonly cuerpoPanel: HTMLElement
  private readonly memoria: VistaMemoria
  private readonly ajustes: VistaAjustes
  private readonly uso: VistaUso
  private readonly contenido: VistaContenido
  private readonly metricas: VistaMetricas
  private readonly botonMetricas: HTMLButtonElement
  private readonly botonContenido: HTMLButtonElement
  private readonly tareas: VistaTareas
  private readonly botonTareas: HTMLButtonElement
  private readonly botonUso: HTMLButtonElement
  private readonly botonAjustes: HTMLButtonElement
  private readonly botonFijar: HTMLButtonElement
  private readonly lineaEstado: HTMLElement
  private turno: TurnoEnCurso | null = null
  private temporizadorReposo = 0
  private temporizadorEstado = 0
  /** Contexto de pantalla leído que irá con el próximo mensaje (el original vive en el proceso principal). */
  private lectura: LecturaPantalla | null = null
  private leyendo = false
  private inicioLectura = 0
  /** Quién habla (Orbe o una identidad propia como Atlas): lo dice el proceso principal al arrancar. */
  private perfil: PerfilIdentidad = perfilDe({ id: 'orbe', nombre: '', trato: '' })

  constructor(
    private readonly orbe: Avatar,
    raiz: Document = document
  ) {
    const porId = <T extends HTMLElement>(id: string): T => raiz.getElementById(id) as T

    this.lista = new ListaMensajes(porId('mensajes'), porId('vacio'))
    this.botonEnviar = porId('enviar')
    this.botonLeer = porId('leer')
    this.botonMemoria = porId('memoria-boton')
    this.cuerpoPanel = raiz.querySelector('.panel-cuerpo') as HTMLElement
    this.memoria = new VistaMemoria(porId('memoria'), () => this.cerrarMemoria())
    this.ajustes = new VistaAjustes(porId('ajustes'), () => this.cerrarAjustes())
    this.botonAjustes = porId('ajustes-boton')
    this.uso = new VistaUso(porId('uso'), () => this.cerrarUso())
    this.botonUso = porId('uso-boton')
    this.contenido = new VistaContenido(porId('contenido'), () => this.cerrarContenido())
    this.botonContenido = porId('contenido-boton')
    this.metricas = new VistaMetricas(porId('metricas'), () => this.cerrarMetricas(), (encargo) => {
      this.volverAlChat()
      this.alPedirEnvio(encargo)
    })
    this.botonMetricas = porId('metricas-boton')
    this.botonTareas = porId('tareas-boton')
    const insignia = porId('tareas-insignia')
    this.tareas = new VistaTareas(porId('tareas'), () => this.cerrarTareas(), (n) => {
      insignia.hidden = n === 0
      insignia.textContent = String(n)
    })
    this.botonFijar = porId('fijar-boton')
    this.lineaEstado = porId('estado-linea')
    this.botonCapturar = porId('capturar')
    this.botonTextoImagen = porId('texto-imagen')
    this.menuTextoImagen = new MenuTextoImagen(this.botonTextoImagen, porId('texto-imagen-menu'), (modo, origen) => void this.leerImagen(modo, origen))
    this.botonMicro = porId('microfono')
    let almacen: Storage | null = null
    try {
      almacen = window.localStorage
    } catch {
      // sin almacenamiento local, las preferencias de voz duran hasta cerrar Orbe
    }
    this.lector = new LectorVoz((window.speechSynthesis as Sintesis | undefined) ?? null, almacen, {
      neuronal: {
        sintetizar: async (texto) => {
          const r = await window.orbe.vozSintetizar(texto)
          return r.ok ? r : { ok: false, mensaje: r.error.mensaje }
        }
      },
      reproductor: new ReproductorAudio(),
      alError: (mensaje) => this.mostrarEstadoTemporal(mensaje)
    })
    this.menuVoz = new MenuVoz(porId('voz-boton'), porId('voz-menu'), this.lector)
    this.menuPotencia = new MenuPotencia(porId('potencia-boton'), porId('potencia-menu'))
    // Si no hay voz neuronal configurada, el motor neuronal que quedara guardado se ignora y se habla con Windows.
    void window.orbe
      .vozInfo()
      .then((info) => this.lector.fijarNeuronalConfigurado(info.neuronal))
      .catch(() => this.lector.fijarNeuronalConfigurado(false))
    this.dictado = new Dictado({
      alEstado: (estado, segundos) => this.alEstadoDictado(estado, segundos),
      alTexto: (texto) => this.alTextoDictado(texto),
      alError: (mensaje) => this.mostrarEstadoTemporal(mensaje)
    })
    this.confirmacion = new ConfirmacionCaptura(porId('confirmacion'))
    this.confirmacionAccion = new ConfirmacionAccion(porId('confirmacion'), this.confirmacion)
    this.botonDetenerAccion = porId('detener-accion')
    this.botonDetenerOrbe = porId('detener-orbe')
    this.botonDetenerAccion.addEventListener('click', () => this.cancelar())
    this.botonDetenerOrbe.addEventListener('click', (e) => {
      e.stopPropagation()
      this.cancelar()
    })
    this.sugerencia = new SugerenciaCaptura(
      porId('sugerencia'),
      () => void this.pedirCaptura(),
      () => {
        this.sugerenciaDescartada = true
        this.sugerencia.ocultar()
      }
    )
    this.entrada = new EntradaTeclado(porId<HTMLTextAreaElement>('entrada'), () => {
      this.actualizarBoton()
      this.evaluarSugerencia()
    })
    this.barra = new BarraContexto(
      porId('pendiente'),
      (clave) => void this.quitarParte(clave),
      () => this.descartarContexto()
    )

    this.entrada.alEnviar((texto) => this.alPedirEnvio(texto))
    this.botonEnviar.addEventListener('click', () => {
      if (this.turno) this.cancelar()
      else this.entrada.enviar()
    })
    this.botonLeer.addEventListener('click', () => void this.leerPantalla())
    this.botonCapturar.addEventListener('click', () => void this.pedirCaptura())
    this.botonMicro.addEventListener('click', () => void this.dictado.alternar())
    this.botonMemoria.addEventListener('click', () => void this.alternarMemoria())
    this.botonUso.addEventListener('click', () => void this.alternarUso())
    this.botonContenido.addEventListener('click', () => void this.alternarContenido())
    this.botonMetricas.addEventListener('click', () => void this.alternarMetricas())
    this.botonTareas.addEventListener('click', () => void this.alternarTareas())
    // Barra lateral: «Chat» cierra la sección abierta, y se marca solo cuando no hay ninguna.
    const botonChat = porId<HTMLButtonElement>('chat-boton')
    botonChat.addEventListener('click', () => this.volverAlChat())
    const secciones = ['memoria', 'ajustes', 'uso', 'tareas', 'contenido', 'metricas'].map((id) => porId(id))
    const marcarChat = (): void => botonChat.setAttribute('aria-pressed', String(secciones.every((sec) => sec.hidden)))
    const observador = new MutationObserver(marcarChat)
    for (const sec of secciones) observador.observe(sec, { attributes: true, attributeFilter: ['hidden'] })
    marcarChat()
    this.botonAjustes.addEventListener('click', () => void this.alternarAjustes())
    porId('cerrar-boton').addEventListener('click', () => window.orbe.alternar())
    this.botonFijar.addEventListener('click', () => void this.alternarFijado())
    void this.mostrarFijado()
    porId('nueva').addEventListener('click', () => void this.nuevaConversacion())

    // Los enlaces de las respuestas se abren en el navegador, nunca dentro de Orbe.
    porId('mensajes').addEventListener('click', (e) => {
      const enlace = (e.target as HTMLElement).closest('a[href]')
      if (!enlace) return
      e.preventDefault()
      window.orbe.abrirEnlace(enlace.getAttribute('href') ?? '')
    })

    window.orbe.alEventoChat((evento) => this.alEvento(evento))
    window.orbe.alEventoPantalla((evento) => this.alEventoPantalla(evento))
    window.orbe.alOrdenApp((orden) => {
      if (orden === 'nueva-conversacion') void this.nuevaConversacion()
    })
    void this.mostrarInfo(porId('modelo'))
    this.actualizarBoton()
  }

  private async mostrarInfo(chip: HTMLElement): Promise<void> {
    try {
      const info: InfoChat | null = await window.orbe.chatInfo()
      if (!info) return
      chip.textContent = info.modeloLegible
      const via = { cli: 'el CLI de Claude', api: 'la API de Anthropic', openai: 'una API compatible con OpenAI' }[info.proveedor]
      chip.title = `${info.modelo} · mediante ${via}`
      chip.hidden = false
      this.aplicarIdentidad(perfilDe(info.identidad))
    } catch {
      // Sin información no se muestra el chip; el chat funciona igual.
    }
  }

  enfocar(): void {
    if (!this.memoria.visible && !this.ajustes.visible && !this.uso.visible && !this.tareas.visible && !this.contenido.visible && !this.metricas.visible) this.entrada.enfocar()
  }

  // -------------------------------------------------------------------------------------------
  // Configuración y fijado del panel
  // -------------------------------------------------------------------------------------------

  private async alternarAjustes(): Promise<void> {
    if (this.ajustes.visible) {
      this.cerrarAjustes()
      return
    }
    this.cerrarMemoria()
    this.cerrarUso()
    this.cerrarContenido()
    this.cerrarMetricas()
    this.cerrarTareas()
    this.cuerpoPanel.hidden = true
    this.botonAjustes.setAttribute('aria-pressed', 'true')
    await this.ajustes.abrir()
  }

  private cerrarAjustes(): void {
    if (!this.ajustes.visible) return
    this.ajustes.cerrar()
    this.cuerpoPanel.hidden = false
    this.botonAjustes.setAttribute('aria-pressed', 'false')
    this.entrada.enfocar()
  }

  private async alternarUso(): Promise<void> {
    if (this.uso.visible) {
      this.cerrarUso()
      return
    }
    this.cerrarMemoria()
    this.cerrarAjustes()
    this.cerrarTareas()
    this.cerrarContenido()
    this.cerrarMetricas()
    this.cuerpoPanel.hidden = true
    this.botonUso.setAttribute('aria-pressed', 'true')
    await this.uso.abrir()
  }

  private cerrarUso(): void {
    if (!this.uso.visible) return
    this.uso.cerrar()
    this.cuerpoPanel.hidden = false
    this.botonUso.setAttribute('aria-pressed', 'false')
    this.entrada.enfocar()
  }

  private async alternarContenido(): Promise<void> {
    if (this.contenido.visible) {
      this.cerrarContenido()
      return
    }
    this.cerrarMemoria()
    this.cerrarAjustes()
    this.cerrarUso()
    this.cerrarTareas()
    this.cerrarMetricas()
    this.cuerpoPanel.hidden = true
    this.botonContenido.setAttribute('aria-pressed', 'true')
    await this.contenido.abrir()
  }

  private cerrarContenido(): void {
    if (!this.contenido.visible) return
    this.contenido.cerrar()
    this.cuerpoPanel.hidden = false
    this.botonContenido.setAttribute('aria-pressed', 'false')
    this.entrada.enfocar()
  }

  private async alternarMetricas(): Promise<void> {
    if (this.metricas.visible) {
      this.cerrarMetricas()
      return
    }
    this.cerrarMemoria()
    this.cerrarAjustes()
    this.cerrarUso()
    this.cerrarTareas()
    this.cerrarContenido()
    this.cuerpoPanel.hidden = true
    this.botonMetricas.setAttribute('aria-pressed', 'true')
    await this.metricas.abrir()
  }

  private cerrarMetricas(): void {
    if (!this.metricas.visible) return
    this.metricas.cerrar()
    this.cuerpoPanel.hidden = false
    this.botonMetricas.setAttribute('aria-pressed', 'false')
    this.entrada.enfocar()
  }

  /** Cierra la sección que esté abierta (tareas, consumo, memoria o ajustes) y vuelve a la conversación. */
  private volverAlChat(): void {
    this.cerrarTareas()
    this.cerrarUso()
    this.cerrarContenido()
    this.cerrarMetricas()
    this.cerrarMemoria()
    this.cerrarAjustes()
    this.entrada.enfocar()
  }

  private async alternarTareas(): Promise<void> {
    if (this.tareas.visible) {
      this.cerrarTareas()
      return
    }
    this.cerrarMemoria()
    this.cerrarAjustes()
    this.cerrarUso()
    this.cerrarContenido()
    this.cerrarMetricas()
    this.cuerpoPanel.hidden = true
    this.botonTareas.setAttribute('aria-pressed', 'true')
    await this.tareas.abrir()
  }

  private cerrarTareas(): void {
    if (!this.tareas.visible) return
    this.tareas.cerrar()
    this.cuerpoPanel.hidden = false
    this.botonTareas.setAttribute('aria-pressed', 'false')
    this.entrada.enfocar()
  }

  private pintarFijado(fijado: boolean): void {
    this.botonFijar.setAttribute('aria-pressed', String(fijado))
    this.botonFijar.title = fijado
      ? 'Fijado: el panel se queda por encima de las demás ventanas (pulsa para soltarlo)'
      : 'Suelto: otras ventanas pueden taparlo (pulsa para fijarlo encima)'
  }

  private async mostrarFijado(): Promise<void> {
    try {
      this.pintarFijado(await window.orbe.fijarPanel())
    } catch {
      // sin el dato, el botón se queda como está
    }
  }

  private async alternarFijado(): Promise<void> {
    try {
      const ahora = this.botonFijar.getAttribute('aria-pressed') === 'true'
      this.pintarFijado(await window.orbe.fijarPanel(!ahora))
    } catch {
      // no se pudo cambiar: el botón conserva su estado
    }
  }

  // -------------------------------------------------------------------------------------------
  // Memoria: gestor, conversación guardada y órdenes «recuerda que…»
  // -------------------------------------------------------------------------------------------

  private async alternarMemoria(): Promise<void> {
    if (this.memoria.visible) {
      this.cerrarMemoria()
      return
    }
    this.cerrarAjustes()
    this.cerrarUso()
    this.cerrarContenido()
    this.cerrarMetricas()
    this.cerrarTareas()
    this.cuerpoPanel.hidden = true
    this.botonMemoria.setAttribute('aria-pressed', 'true')
    await this.memoria.abrir()
  }

  private cerrarMemoria(): void {
    if (!this.memoria.visible) return
    this.memoria.cerrar()
    this.cuerpoPanel.hidden = false
    this.botonMemoria.setAttribute('aria-pressed', 'false')
    this.entrada.enfocar()
  }

  /** Esc: si hay una confirmación de captura o el gestor de memoria abierto, los cierra y devuelve true (el panel se queda abierto). */
  alPulsarEscape(): boolean {
    if (this.menuTextoImagen.cerrarSiAbierto()) return true
    if (this.menuVoz.cerrarSiAbierto()) return true
    if (this.menuPotencia.cerrarSiAbierto()) return true
    if (this.dictado.grabando) {
      this.dictado.cancelar()
      return true
    }
    if (this.lector.hablando) {
      this.lector.parar()
      return true
    }
    if (this.confirmacionAccion.visible) {
      // Esc en la tarjeta del agente es un «Cancelar»: la acción no se hace y la tarea sigue su curso.
      this.confirmacionAccion.cancelar()
      return true
    }
    if (this.confirmacion.visible) {
      this.confirmacion.cancelar()
      return true
    }
    if (this.turno?.conAcciones) {
      // Mientras el agente trabaja, Esc lo detiene (en lugar de plegar el panel).
      this.cancelar()
      return true
    }
    if (this.ajustes.visible) {
      this.cerrarAjustes()
      return true
    }
    if (this.uso.visible) {
      this.cerrarUso()
      return true
    }
    if (this.contenido.visible) {
      this.cerrarContenido()
      return true
    }
    if (this.metricas.visible) {
      this.cerrarMetricas()
      return true
    }
    if (this.tareas.visible) {
      this.cerrarTareas()
      return true
    }
    if (!this.memoria.visible) return false
    this.cerrarMemoria()
    return true
  }

  /** Al abrir Orbe: enseña el aviso de la primera importación y repone la conversación que quedó guardada. */
  async restaurarConversacion(): Promise<void> {
    try {
      const inicio = await window.orbe.memoriaInicio()
      if (inicio.bienvenida) this.lista.agregarAvisoInicial(inicio.bienvenida)
      if (inicio.mensajes.length > 0 && !this.lista.hayMensajes()) {
        for (const m of inicio.mensajes) {
          if (m.rol === 'usuario') this.lista.agregarUsuario(m.texto)
          else this.lista.agregarRespuestaGuardada(m.texto)
        }
        this.lista.agregarAviso('Conversación anterior restaurada. Sigue donde la dejaste o pulsa el lápiz para empezar de cero.')
      }
    } catch {
      // Sin memoria, Orbe funciona igual: simplemente empieza en blanco.
    }
  }

  private async deshacerRecuerdo(id: string): Promise<boolean> {
    try {
      return (await window.orbe.memoriaBorrar(id)).ok
    } catch {
      return false
    }
  }

  // -------------------------------------------------------------------------------------------
  // Contexto de pantalla (siempre bajo demanda: botón o atajo)
  // -------------------------------------------------------------------------------------------

  /** Botón del ojo: lee la ventana en la que estabas y la deja lista para el próximo mensaje. */
  async leerPantalla(): Promise<void> {
    if (this.leyendo) return
    this.empezarLectura()
    try {
      const respuesta = await window.orbe.pantallaLeer()
      await this.esperarLecturaMinima()
      if (respuesta.ok) this.fijarLectura({ partes: respuesta.partes, avisos: respuesta.avisos, sugerirCaptura: respuesta.sugerirCaptura })
      else this.lista.agregarError(respuesta.error)
    } catch (e) {
      await this.esperarLecturaMinima()
      this.lista.agregarError(this.errorLocal(e))
    } finally {
      this.terminarLectura()
    }
  }

  private empezarLectura(): void {
    this.leyendo = true
    this.inicioLectura = performance.now()
    this.botonLeer.disabled = true
    this.botonLeer.classList.add('leyendo')
    // Si Claude está respondiendo, el orbe sigue con su movimiento: el destello solo se usa en calma.
    if (!this.turno) this.cambiarEstadoOrbe('leyendo')
  }

  private async esperarLecturaMinima(): Promise<void> {
    const falta = LECTURA_MIN_MS - (performance.now() - this.inicioLectura)
    if (falta > 0) await new Promise((r) => window.setTimeout(r, falta))
  }

  private terminarLectura(): void {
    this.leyendo = false
    this.botonLeer.disabled = false
    this.botonLeer.classList.remove('leyendo')
    if (!this.turno) this.cambiarEstadoOrbe('reposo')
  }

  private fijarLectura(lectura: LecturaPantalla): void {
    this.lectura = lectura
    this.barra.mostrar(lectura)
    this.actualizarBoton()
    this.evaluarSugerencia()
    this.entrada.enfocar()
  }

  private limpiarLectura(): void {
    this.lectura = null
    this.barra.limpiar()
    this.actualizarBoton()
    this.evaluarSugerencia()
  }

  // -------------------------------------------------------------------------------------------
  // Captura de pantalla (último recurso, siempre con confirmación)
  // -------------------------------------------------------------------------------------------

  /** Pide confirmación y, si el usuario acepta, hace la captura y la deja pendiente con su vista previa. */
  async pedirCaptura(): Promise<void> {
    if (this.capturando || this.leyendo || this.confirmacion.visible || this.confirmacionAccion.visible) return
    this.sugerencia.ocultar()
    if (!(await this.confirmacion.pedir())) {
      this.evaluarSugerencia()
      this.entrada.enfocar()
      return
    }

    this.capturando = true
    this.botonCapturar.disabled = true
    this.botonCapturar.classList.add('leyendo')
    if (!this.turno) this.cambiarEstadoOrbe('leyendo')
    try {
      const respuesta = await window.orbe.pantallaCapturar()
      if (respuesta.ok) {
        // La vista previa queda desplegada: así se ve exactamente lo que se enviará antes de enviarlo.
        this.barra.abrir('imagen')
        this.fijarLectura({ partes: respuesta.partes, avisos: respuesta.avisos, sugerirCaptura: respuesta.sugerirCaptura })
      } else {
        this.lista.agregarError(respuesta.error, () => void this.pedirCaptura())
      }
    } catch (e) {
      this.lista.agregarError(this.errorLocal(e))
    } finally {
      this.capturando = false
      this.botonCapturar.disabled = false
      this.botonCapturar.classList.remove('leyendo')
      if (!this.turno && !this.leyendo) this.cambiarEstadoOrbe('reposo')
      this.evaluarSugerencia()
    }
  }

  // -------------------------------------------------------------------------------------------
  // Texto de una imagen (OCR de Windows en el equipo, sin pantallazo del monitor)
  // -------------------------------------------------------------------------------------------

  /** Lo que se escribe solo al preparar una fórmula, si el campo está vacío (se puede cambiar antes de enviar). */
  static readonly PEDIDO_FORMULA = 'Reconoce la fórmula o la estructura de la imagen y resuélvela paso a paso.'

  /**
   * Texto: reconoce el texto de una imagen (ventana, portapapeles o archivo) en el equipo y lo deja pendiente.
   * Fórmula: deja la imagen pendiente, con su miniatura, para que la IA la reconozca y la resuelva.
   */
  async leerImagen(modo: ModoImagen, origen: OrigenTextoImagen): Promise<void> {
    if (this.reconociendo || this.capturando || this.leyendo) return
    this.reconociendo = true
    this.botonTextoImagen.disabled = true
    this.botonTextoImagen.classList.add('leyendo')
    if (!this.turno) this.cambiarEstadoOrbe('leyendo')
    try {
      const antes = this.lectura?.partes.find((p) => p.clave === (modo === 'formula' ? 'imagen' : 'texto_imagen'))?.resumen
      const respuesta = modo === 'formula' ? await window.orbe.pantallaFormula(origen) : await window.orbe.pantallaTextoImagen(origen)
      if (respuesta.ok) {
        const lectura = { partes: respuesta.partes, avisos: respuesta.avisos, sugerirCaptura: respuesta.sugerirCaptura }
        const clave = modo === 'formula' ? 'imagen' : 'texto_imagen'
        const nueva = respuesta.partes.find((p) => p.clave === clave)
        // Solo si de verdad hay algo nuevo (cancelar el diálogo de archivo deja todo como estaba).
        const hayNueva = !!nueva && nueva.resumen !== antes
        if (hayNueva) this.barra.abrir(clave)
        if (respuesta.partes.length > 0) this.fijarLectura(lectura)
        if (hayNueva && modo === 'formula' && !this.entrada.hayTexto()) this.entrada.insertar(PanelChat.PEDIDO_FORMULA)
      } else {
        this.lista.agregarError(respuesta.error, respuesta.error.reintentable ? () => void this.leerImagen(modo, origen) : undefined)
      }
    } catch (e) {
      this.lista.agregarError(this.errorLocal(e))
    } finally {
      this.reconociendo = false
      this.botonTextoImagen.disabled = false
      this.botonTextoImagen.classList.remove('leyendo')
      if (!this.turno && !this.leyendo && !this.capturando) this.cambiarEstadoOrbe('reposo')
      this.evaluarSugerencia()
      this.entrada.enfocar()
    }
  }

  /**
   * Propone una captura cuando puede ayudar: la ventana leída casi no tenía texto, o lo que se está escribiendo
   * parece una pregunta sobre cómo se ve algo. Es solo una sugerencia; nunca captura por su cuenta.
   */
  private evaluarSugerencia(): void {
    const hayImagen = this.lectura?.partes.some((p) => p.clave === 'imagen') ?? false
    if (hayImagen || this.sugerenciaDescartada || this.capturando || this.confirmacion.visible || this.confirmacionAccion.visible) {
      this.sugerencia.ocultar()
    } else if (this.lectura?.sugerirCaptura) {
      this.sugerencia.mostrar('¿Adjuntas una captura? Puede ayudar a Claude a entender esa ventana.')
    } else if (esPreguntaVisual(this.entrada.texto())) {
      this.sugerencia.mostrar('Parece una pregunta sobre cómo se ve algo. Puedes adjuntar una captura.')
    } else {
      this.sugerencia.ocultar()
    }
  }

  private async quitarParte(clave: ClaveParte): Promise<void> {
    try {
      const lectura = await window.orbe.pantallaQuitar(clave)
      if (lectura) this.fijarLectura(lectura)
      else this.limpiarLectura()
    } catch {
      // Si no se pudo quitar, la barra se queda como estaba.
    }
  }

  private descartarContexto(): void {
    window.orbe.pantallaDescartar()
    this.limpiarLectura()
  }

  /** Eventos que llegan del proceso principal sin que el panel los pida (atajo de leer, caducidad…). */
  private alEventoPantalla(evento: EventoPantalla): void {
    switch (evento.tipo) {
      case 'leyendo':
        if (evento.activo) {
          if (!this.leyendo) {
            this.leyendo = true
            this.inicioLectura = performance.now()
            if (!this.turno) this.cambiarEstadoOrbe('leyendo')
          }
        } else if (this.leyendo) {
          void this.esperarLecturaMinima().then(() => this.terminarLectura())
        }
        break
      case 'pendiente':
        this.fijarLectura(evento.lectura)
        break
      case 'vacio':
        this.limpiarLectura()
        if (evento.motivo === 'caducado') {
          this.mostrarEstadoTemporal('El contexto de pantalla caducó. Vuelve a leerla si lo necesitas.')
        }
        break
      case 'error':
        this.lista.agregarError(evento.error)
        break
    }
  }

  // -------------------------------------------------------------------------------------------
  // Envío
  // -------------------------------------------------------------------------------------------

  private alPedirEnvio(texto: string): void {
    if (this.turno) return
    this.sugerenciaDescartada = false
    this.entrada.limpiar()
    const burbuja = this.lista.agregarUsuario(texto)
    // «parte» y «protocolo …» los resuelve la propia identidad, sin gastar una llamada al modelo.
    if (!this.lectura) {
      if (pideParte(texto, this.perfil.nombre)) {
        void this.darParte()
        return
      }
      const protocolo = pideProtocolo(texto, this.perfil.nombre)
      if (protocolo) {
        void this.lanzarProtocolo(protocolo)
        return
      }
    }
    void this.iniciarTurno(texto, burbuja)
  }

  // -------------------------------------------------------------------------------------------
  // Identidad: quién habla, el parte de situación y los protocolos
  // -------------------------------------------------------------------------------------------

  private aplicarIdentidad(perfil: PerfilIdentidad): void {
    this.perfil = perfil
    document.documentElement.dataset['identidad'] = perfil.id
    const titulo = document.querySelector('.panel-titulo')
    if (titulo) titulo.textContent = perfil.nombre
    const vacio = document.querySelector('.vacio-titulo')
    if (vacio && perfil.id !== 'orbe') vacio.textContent = `${perfil.nombre}, a su servicio.`
  }

  /** Al abrir el panel: una identidad propia da el parte de situación una vez al día, sin que se lo pidan. */
  alAbrirPanel(): void {
    if (this.perfil.id === 'orbe' || this.turno) return
    const hoy = new Date().toDateString()
    if (leerLocal('orbe.parte.dia') === hoy) return
    escribirLocal('orbe.parte.dia', hoy)
    void this.darParte()
  }

  /** Habla como la identidad: una respuesta local (sin modelo) que se pinta, se lee en voz alta y se acompaña con un gesto. */
  private hablarLocal(markdown: string, gesto: 'saludo' | 'reverencia' | 'asentir' | 'negar' | null): void {
    this.lista.agregarRespuestaGuardada(markdown)
    this.lista.desplazarAlFinal()
    if (gesto) this.orbe.gesto?.(gesto, true)
    this.lector.empezar()
    this.lector.anexar(textoPlano(markdown))
    this.lector.terminar()
  }

  async darParte(): Promise<void> {
    const desde = Number(leerLocal('orbe.parte.ultimo') ?? '0') || Date.now() - 24 * 3_600_000
    const [estado, uso] = await Promise.all([
      window.orbe.tareasEstado().catch(() => null),
      window.orbe.usoResumen().catch(() => null)
    ])
    escribirLocal('orbe.parte.ultimo', String(Date.now()))
    const texto = parteDeSituacion(this.perfil, datosDelParte(estado, uso, new Date(), desde))
    this.hablarLocal(texto, this.perfil.formal ? 'reverencia' : 'saludo')
  }

  private async lanzarProtocolo(pedido: string): Promise<void> {
    const f = frases(this.perfil)
    const estado = await window.orbe.tareasEstado().catch(() => null)
    const tareas = estado?.tareas ?? []
    const tarea = buscarProtocolo(pedido, tareas)
    if (!tarea) {
      this.hablarLocal(f.protocoloDesconocido(pedido, tareas.map((t) => t.titulo).slice(0, 8)), 'negar')
      return
    }
    if (tarea.ultima && (tarea.ultima.estado === 'en-curso' || tarea.ultima.estado === 'esperando')) {
      this.hablarLocal(f.protocoloOcupado(tarea.titulo), null)
      return
    }
    try {
      await window.orbe.tareasEjecutar(tarea.id)
      const aviso = this.perfil.formal ? 'Le aviso al terminar; el progreso está en Tareas.' : 'Te aviso al terminar; lo ves en Tareas.'
      this.hablarLocal(`${f.protocoloInicio(tarea.titulo)} ${aviso}`, 'asentir')
    } catch {
      this.hablarLocal(f.protocoloError(tarea.titulo), 'negar')
    }
  }

  /** `burbuja` es el mensaje del usuario al que se le cuelgan los chips; null al reintentar (ya los tiene). */
  private async iniciarTurno(texto: string, burbuja: HTMLElement | null): Promise<void> {
    const id = crypto.randomUUID()
    const respuesta = this.lista.iniciarRespuesta()
    this.turno = { id, texto, respuesta, recibioTexto: false, conAcciones: false, acumulado: '' }
    const caraUsuario = expresionDeTexto(texto, 'usuario')
    if (caraUsuario) this.orbe.expresar(caraUsuario, 1800)
    this.ocultarEstado()
    this.cambiarEstadoOrbe('pensando')
    this.entrada.bloquear(false)
    this.actualizarBoton()

    let resultado: ResultadoEnvio
    try {
      resultado = await window.orbe.chatEnviar({ id, texto, conContexto: this.lectura !== null })
    } catch (e) {
      resultado = { ok: false, error: this.errorLocal(e) }
    }

    if (resultado.ok) {
      // Lo que se adjuntó, tal como lo confirma el proceso principal, queda a la vista en el mensaje.
      if (burbuja) this.lista.adjuntarChips(burbuja, resultado.adjuntos)
      if (burbuja && resultado.memoria) {
        this.lista.adjuntarAvisoMemoria(burbuja, resultado.memoria, (id) => this.deshacerRecuerdo(id))
      }
      if (resultado.adjuntos.length > 0) this.limpiarLectura()
    } else if (this.turno?.id === id) {
      this.terminarTurnoConError(resultado.error)
    }
  }

  private errorLocal(e: unknown): ErrorOrbe {
    return {
      codigo: 'desconocido',
      titulo: 'Algo ha fallado',
      mensaje: 'No he podido comunicarme con el proceso principal de Orbe.',
      reintentable: true,
      detalle: e instanceof Error ? e.message : String(e)
    }
  }

  private cancelar(): void {
    this.lector.parar()
    if (this.turno) window.orbe.chatCancelar(this.turno.id)
  }

  // -------------------------------------------------------------------------------------------
  // Dictado por micrófono
  // -------------------------------------------------------------------------------------------

  private alEstadoDictado(estado: EstadoDictado, segundos: number): void {
    this.botonMicro.classList.toggle('grabando', estado === 'grabando')
    this.botonMicro.disabled = estado === 'transcribiendo'
    if (estado === 'reposo') {
      if (this.mostrandoDictado) {
        this.mostrandoDictado = false
        this.ocultarEstado()
      }
      if (!this.turno && !this.leyendo && !this.capturando) this.cambiarEstadoOrbe('reposo')
      return
    }
    this.mostrandoDictado = true
    if (estado === 'preparando') {
      this.mostrarEstado('Abriendo el micrófono… (Esc cancela)')
      if (!this.turno) this.cambiarEstadoOrbe('escuchando')
    } else if (estado === 'grabando') {
      const tiempo = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`
      this.mostrarEstado(`Grabando… ${tiempo} · pulsa el micrófono para terminar (Esc cancela)`)
      if (!this.turno) this.cambiarEstadoOrbe('escuchando')
    } else {
      this.mostrarEstado('Transcribiendo…')
      if (!this.turno) this.cambiarEstadoOrbe('pensando')
    }
  }

  /** Llega el texto dictado: se añade al mensaje (y se envía si así se pidió en el menú de voz). */
  private alTextoDictado(texto: string): void {
    this.entrada.insertar(texto)
    this.entrada.enfocar()
    if (this.lector.obtenerPrefs().autoenviar && !this.turno) this.entrada.enviar()
  }

  async nuevaConversacion(): Promise<void> {
    this.cerrarMemoria()
    this.cerrarAjustes()
    this.confirmacion.cancelar()
    this.confirmacionAccion.cancelar()
    this.dictado.cancelar()
    this.lector.parar()
    this.sugerenciaDescartada = false
    const turno = this.turno
    this.turno = null
    turno?.respuesta.descartarSiVacia()
    this.ocultarEstado()
    this.descartarContexto()
    try {
      await window.orbe.chatNueva()
    } catch {
      // Si el proceso principal no responde, igualmente se limpia la vista.
    }
    this.lista.limpiar()
    this.cambiarEstadoOrbe('reposo')
    this.actualizarBoton()
    this.entrada.enfocar()
    // La conversación nueva arranca con un proceso nuevo: se deja listo para que el primer mensaje salga rápido.
    window.orbe.chatPrecalentar()
  }

  // -------------------------------------------------------------------------------------------
  // Eventos del chat
  // -------------------------------------------------------------------------------------------

  private alEvento(evento: EventoChat): void {
    const turno = this.turno
    if (!turno || evento.id !== turno.id) return // eventos de un turno ya descartado

    switch (evento.tipo) {
      case 'inicio':
        this.lector.empezar()
        break
      case 'texto':
        if (!turno.recibioTexto) {
          turno.recibioTexto = true
          this.ocultarEstado()
          this.cambiarEstadoOrbe('respondiendo')
          // Un tramo nuevo tras una acción del agente: al leer en voz alta no se pega al anterior.
          if (turno.conAcciones) this.lector.anexar('\n\n')
        }
        turno.respuesta.anexar(evento.delta)
        if (turno.acumulado.length < 4000) turno.acumulado += evento.delta
        this.lector.anexar(evento.delta)
        // Cada fragmento mueve el orbe: más texto de golpe, onda más fuerte.
        this.orbe.pulso(Math.min(0.7, 0.18 + evento.delta.length / 40))
        break
      case 'reintento':
        this.mostrarEstado(`Reconectando con Claude… (intento ${evento.intento} de ${evento.maximo})`)
        break
      case 'aviso':
        this.lista.agregarAviso(evento.texto)
        break
      case 'accion':
        this.alAccion(turno, evento.accion)
        break
      case 'fuentes':
        turno.respuesta.agregarFuentes(evento.fuentes)
        break
      case 'confirmar': {
        const { confirmacion } = evento
        void this.confirmacionAccion.pedir(confirmacion).then((permitir) => {
          // Si el turno ya terminó (o se detuvo) la respuesta no tiene a quién llegar.
          if (this.turno?.id === turno.id) window.orbe.chatConfirmar(turno.id, confirmacion.confirmacionId, permitir)
        })
        break
      }
      case 'fin':
        this.confirmacionAccion.cancelar()
        this.ocultarEstado()
        turno.respuesta.finalizar(evento.motivo)
        // Al terminar, la cara acompaña lo que dijo (contento, orgulloso si lo hizo, preocupado si no pudo…).
        if (evento.motivo === 'completo') {
          const cara = expresionDeTexto(turno.acumulado, 'respuesta')
          if (cara) {
            this.orbe.expresar(cara, 3500)
            const gesto = gestoDeExpresion(cara)
            // «Feliz» es lo normal: solo uno de cada tres asiente, para que no lo haga siempre igual.
            if (gesto && (cara !== 'feliz' || Math.random() < 0.34)) this.orbe.gesto?.(gesto)
          }
        }
        this.lector.terminar()
        this.turno = null
        this.programarReposo()
        this.actualizarBoton()
        this.entrada.enfocar()
        break
      case 'error':
        this.terminarTurnoConError(evento.error)
        break
    }
  }

  /** Una acción del agente empieza o termina: se pinta su línea y el orbe pasa a «actuando» (o vuelve a «pensando»). */
  private alAccion(turno: TurnoEnCurso, accion: AccionVista): void {
    const primera = !turno.conAcciones
    turno.conAcciones = true
    this.ocultarEstado()
    turno.respuesta.agregarAccion(accion)
    if (accion.estado === 'en_curso') {
      this.cambiarEstadoOrbe('actuando')
    } else {
      // La acción terminó: el modelo decide qué hacer con el resultado, y su próximo texto abre un tramo nuevo.
      turno.recibioTexto = false
      this.cambiarEstadoOrbe('pensando')
    }
    if (primera) this.actualizarBoton()
  }

  private terminarTurnoConError(error: ErrorOrbe): void {
    const turno = this.turno
    if (!turno) return
    this.confirmacionAccion.cancelar()
    this.lector.parar()
    this.turno = null
    this.ocultarEstado()
    turno.respuesta.descartarSiVacia()
    this.orbe.expresar('preocupado', 4000)
    this.lista.agregarError(error, () => void this.reintentar(turno.texto))
    this.programarReposo()
    this.actualizarBoton()
  }

  /** Reenvía el último mensaje sin duplicar la burbuja del usuario. */
  private async reintentar(texto: string): Promise<void> {
    if (this.turno) return
    await this.iniciarTurno(texto, null)
  }

  // -------------------------------------------------------------------------------------------
  // Presentación
  // -------------------------------------------------------------------------------------------

  private cambiarEstadoOrbe(estado: Parameters<Avatar['establecerEstado']>[0]): void {
    window.clearTimeout(this.temporizadorReposo)
    this.orbe.establecerEstado(estado)
  }

  private programarReposo(): void {
    window.clearTimeout(this.temporizadorReposo)
    this.temporizadorReposo = window.setTimeout(() => {
      if (!this.leyendo) this.orbe.establecerEstado('reposo')
    }, RETRASO_REPOSO_MS)
  }

  private mostrarEstado(texto: string): void {
    window.clearTimeout(this.temporizadorEstado)
    this.lineaEstado.textContent = texto
    this.lineaEstado.hidden = false
  }

  private mostrarEstadoTemporal(texto: string): void {
    this.mostrarEstado(texto)
    this.temporizadorEstado = window.setTimeout(() => this.ocultarEstado(), 6000)
  }

  private ocultarEstado(): void {
    window.clearTimeout(this.temporizadorEstado)
    this.lineaEstado.hidden = true
    this.lineaEstado.textContent = ''
  }

  private actualizarBoton(): void {
    const enCurso = this.turno !== null
    this.botonEnviar.classList.toggle('detener', enCurso)
    this.botonEnviar.setAttribute('aria-label', enCurso ? 'Detener la respuesta' : 'Enviar')
    this.botonEnviar.title = enCurso ? 'Detener la respuesta' : 'Enviar (Enter)'
    this.botonEnviar.disabled = !enCurso && !this.entrada.hayTexto()
    // Mientras el agente trabaja hay un «Detener» más a la vista: sobre el campo y, con el panel plegado, sobre el orbe.
    const actuando = this.turno?.conAcciones === true
    this.botonDetenerAccion.hidden = !actuando
    this.botonDetenerOrbe.hidden = !actuando
  }
}

function leerLocal(clave: string): string | null {
  try {
    return window.localStorage.getItem(clave)
  } catch {
    return null
  }
}

function escribirLocal(clave: string, valor: string): void {
  try {
    window.localStorage.setItem(clave, valor)
  } catch {
    // Sin almacenamiento local, el parte se puede repetir: no pasa nada.
  }
}
