import type {
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
import { EntradaTeclado } from '../entrada/entrada'
import { VistaAjustes } from '../ajustes/vista-ajustes'
import { VistaMemoria } from '../memoria/vista-memoria'
import type { Orbe } from '../orbe/orbe'
import { Dictado, type EstadoDictado } from '../voz/dictado'
import { LectorVoz, type Sintesis } from '../voz/lector'
import { ReproductorAudio } from '../voz/reproductor'
import { MenuVoz } from '../voz/menu-voz'
import { ConfirmacionCaptura, SugerenciaCaptura } from './captura-ui'
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

  constructor(
    private readonly orbe: Orbe,
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
    this.botonFijar = porId('fijar-boton')
    this.lineaEstado = porId('estado-linea')
    this.botonCapturar = porId('capturar')
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
    } catch {
      // Sin información no se muestra el chip; el chat funciona igual.
    }
  }

  enfocar(): void {
    if (!this.memoria.visible && !this.ajustes.visible) this.entrada.enfocar()
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
    void this.iniciarTurno(texto, burbuja)
  }

  /** `burbuja` es el mensaje del usuario al que se le cuelgan los chips; null al reintentar (ya los tiene). */
  private async iniciarTurno(texto: string, burbuja: HTMLElement | null): Promise<void> {
    const id = crypto.randomUUID()
    const respuesta = this.lista.iniciarRespuesta()
    this.turno = { id, texto, respuesta, recibioTexto: false, conAcciones: false }
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
    if (estado === 'grabando') {
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

  private cambiarEstadoOrbe(estado: Parameters<Orbe['establecerEstado']>[0]): void {
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
