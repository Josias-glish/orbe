import type { ErrorOrbe, EventoChat, InfoChat } from '../../shared/tipos'
import { EntradaTeclado } from '../entrada/entrada'
import type { Orbe } from '../orbe/orbe'
import { ListaMensajes, RespuestaEnCurso } from './mensajes'

interface TurnoEnCurso {
  id: string
  texto: string
  respuesta: RespuestaEnCurso
  recibioTexto: boolean
}

/** Pausa antes de volver a «reposo» al terminar, para que las ondas del orbe se apaguen con suavidad. */
const RETRASO_REPOSO_MS = 450

/** Panel de chat: une la lista de mensajes, el campo de entrada, el orbe y el servicio de chat. */
export class PanelChat {
  private readonly lista: ListaMensajes
  private readonly entrada: EntradaTeclado
  private readonly botonEnviar: HTMLButtonElement
  private readonly lineaEstado: HTMLElement
  private turno: TurnoEnCurso | null = null
  private temporizadorReposo = 0

  constructor(
    private readonly orbe: Orbe,
    raiz: Document = document
  ) {
    const porId = <T extends HTMLElement>(id: string): T => raiz.getElementById(id) as T

    this.lista = new ListaMensajes(porId('mensajes'), porId('vacio'))
    this.botonEnviar = porId('enviar')
    this.lineaEstado = porId('estado-linea')
    this.entrada = new EntradaTeclado(porId<HTMLTextAreaElement>('entrada'), () => this.actualizarBoton())

    this.entrada.alEnviar((texto) => this.alPedirEnvio(texto))
    this.botonEnviar.addEventListener('click', () => {
      if (this.turno) this.cancelar()
      else this.entrada.enviar()
    })
    porId('nueva').addEventListener('click', () => void this.nuevaConversacion())

    // Los enlaces de las respuestas se abren en el navegador, nunca dentro de Orbe.
    porId('mensajes').addEventListener('click', (e) => {
      const enlace = (e.target as HTMLElement).closest('a[href]')
      if (!enlace) return
      e.preventDefault()
      window.orbe.abrirEnlace(enlace.getAttribute('href') ?? '')
    })

    window.orbe.alEventoChat((evento) => this.alEvento(evento))
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
  // Envío
  // -------------------------------------------------------------------------------------------

  private alPedirEnvio(texto: string): void {
    if (this.turno) return
    this.entrada.limpiar()
    this.lista.agregarUsuario(texto)
    void this.iniciarTurno(texto)
  }

  private async iniciarTurno(texto: string): Promise<void> {
    const id = crypto.randomUUID()
    const respuesta = this.lista.iniciarRespuesta()
    this.turno = { id, texto, respuesta, recibioTexto: false }
    this.ocultarEstado()
    this.cambiarEstadoOrbe('pensando')
    this.entrada.bloquear(false)
    this.actualizarBoton()

    let resultado: Awaited<ReturnType<typeof window.orbe.chatEnviar>>
    try {
      resultado = await window.orbe.chatEnviar({ id, texto })
    } catch (e) {
      resultado = { ok: false, error: this.errorLocal(e) }
    }
    if (!resultado.ok && this.turno?.id === id) {
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
  // Eventos del proceso principal
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
    await this.iniciarTurno(texto)
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
    this.temporizadorReposo = window.setTimeout(() => this.orbe.establecerEstado('reposo'), RETRASO_REPOSO_MS)
  }

  private mostrarEstado(texto: string): void {
    this.lineaEstado.textContent = texto
    this.lineaEstado.hidden = false
  }

  private ocultarEstado(): void {
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
