import type { ClaveParte, ErrorOrbe, EventoChat, EventoPantalla, InfoChat, LecturaPantalla, ResultadoEnvio } from '../../shared/tipos'
import { EntradaTeclado } from '../entrada/entrada'
import type { Orbe } from '../orbe/orbe'
import { BarraContexto } from './contexto-ui'
import { ListaMensajes, RespuestaEnCurso } from './mensajes'

interface TurnoEnCurso {
  id: string
  texto: string
  respuesta: RespuestaEnCurso
  recibioTexto: boolean
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
    this.lineaEstado = porId('estado-linea')
    this.entrada = new EntradaTeclado(porId<HTMLTextAreaElement>('entrada'), () => this.actualizarBoton())
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
    void this.mostrarInfo(porId('modelo'))
    this.actualizarBoton()
  }

  private async mostrarInfo(chip: HTMLElement): Promise<void> {
    try {
      const info: InfoChat | null = await window.orbe.chatInfo()
      if (!info) return
      chip.textContent = info.modeloLegible
      chip.title = info.proveedor === 'cli' ? `${info.modelo} · mediante el CLI de Claude` : `${info.modelo} · mediante la API`
      chip.hidden = false
    } catch {
      // Sin información no se muestra el chip; el chat funciona igual.
    }
  }

  enfocar(): void {
    this.entrada.enfocar()
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
    this.entrada.enfocar()
  }

  private limpiarLectura(): void {
    this.lectura = null
    this.barra.limpiar()
    this.actualizarBoton()
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
    this.entrada.limpiar()
    const burbuja = this.lista.agregarUsuario(texto)
    void this.iniciarTurno(texto, burbuja)
  }

  /** `burbuja` es el mensaje del usuario al que se le cuelgan los chips; null al reintentar (ya los tiene). */
  private async iniciarTurno(texto: string, burbuja: HTMLElement | null): Promise<void> {
    const id = crypto.randomUUID()
    const respuesta = this.lista.iniciarRespuesta()
    this.turno = { id, texto, respuesta, recibioTexto: false }
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
    if (this.turno) window.orbe.chatCancelar(this.turno.id)
  }

  async nuevaConversacion(): Promise<void> {
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
        break
      case 'texto':
        if (!turno.recibioTexto) {
          turno.recibioTexto = true
          this.ocultarEstado()
          this.cambiarEstadoOrbe('respondiendo')
        }
        turno.respuesta.anexar(evento.delta)
        // Cada fragmento mueve el orbe: más texto de golpe, onda más fuerte.
        this.orbe.pulso(Math.min(0.7, 0.18 + evento.delta.length / 40))
        break
      case 'reintento':
        this.mostrarEstado(`Reconectando con Claude… (intento ${evento.intento} de ${evento.maximo})`)
        break
      case 'aviso':
        this.lista.agregarAviso(evento.texto)
        break
      case 'fin':
        this.ocultarEstado()
        turno.respuesta.finalizar(evento.motivo)
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

  private terminarTurnoConError(error: ErrorOrbe): void {
    const turno = this.turno
    if (!turno) return
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
  }
}
