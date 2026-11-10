/** `preparando`: se ha pulsado y Windows está abriendo el micrófono (puede tardar varios segundos). */
export type EstadoDictado = 'reposo' | 'preparando' | 'grabando' | 'transcribiendo'

export interface CallbacksDictado {
  alEstado(estado: EstadoDictado, segundos: number): void
  /** Ya hay texto: se pone en el campo de mensaje. */
  alTexto(texto: string): void
  alError(mensaje: string): void
}

/** Una grabación más larga se corta sola: el servicio de transcripción limita el tamaño y el dictado es para frases. */
export const MAX_SEGUNDOS = 60
/** Menos que esto es un clic sin hablar: no merece la pena transcribirlo. */
const MIN_BYTES = 1000

export function mensajeDeMicrofono(error: unknown): string {
  const nombre = error instanceof DOMException ? error.name : ''
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError') {
    return 'No tengo permiso para usar el micrófono. Actívalo en Configuración de Windows → Privacidad y seguridad → Micrófono (y deja que las aplicaciones de escritorio lo usen).'
  }
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError') return 'No encuentro ningún micrófono conectado.'
  if (nombre === 'NotReadableError') return 'El micrófono está siendo usado por otra aplicación.'
  return 'No he podido usar el micrófono.'
}

function elegirTipo(): string | undefined {
  for (const tipo of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(tipo)) return tipo
  }
  return undefined
}

/**
 * Dictado por micrófono: graba mientras el usuario quiere (clic para empezar, clic para terminar, Esc para
 * cancelar), manda el audio al proceso principal para que lo transcriba y devuelve el texto. Nada se graba hasta que
 * el usuario pulsa, no se guarda nada en disco y el audio solo sale al terminar.
 */
export class Dictado {
  private estado: EstadoDictado = 'reposo'
  private grabador: MediaRecorder | null = null
  private flujo: MediaStream | null = null
  private trozos: Blob[] = []
  private reloj = 0
  private inicio = 0
  private descartar = false

  constructor(private readonly cb: CallbacksDictado) {}

  get activo(): boolean {
    return this.estado !== 'reposo'
  }

  /** Hay una grabación en marcha o abriéndose: es lo que Esc cancela. */
  get grabando(): boolean {
    return this.estado === 'grabando' || this.estado === 'preparando'
  }

  /**
   * Un clic empieza a grabar; otro clic termina y transcribe. Si el micrófono aún se está abriendo, el segundo clic
   * cancela (nunca arranca otra grabación). Durante la transcripción no hace nada.
   */
  async alternar(): Promise<void> {
    if (this.estado === 'reposo') await this.iniciar()
    else if (this.estado === 'preparando') this.cancelar()
    else if (this.estado === 'grabando') this.terminar()
  }

  private soltarMicrofono(): void {
    this.flujo?.getTracks().forEach((t) => t.stop())
    this.flujo = null
  }

  private aReposo(error?: string): void {
    window.clearInterval(this.reloj)
    this.soltarMicrofono()
    this.grabador = null
    this.estado = 'reposo'
    this.cb.alEstado('reposo', 0)
    if (error) this.cb.alError(error)
  }

  private async iniciar(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.cb.alError('Este equipo no permite grabar audio desde Orbe.')
      return
    }
    // Abrir el micrófono puede tardar segundos (más con auriculares Bluetooth). Se marca ya como ocupado y se avisa:
    // sin esto, un segundo clic durante la espera arrancaba otra grabación que nadie cerraba.
    this.estado = 'preparando'
    this.descartar = false
    this.cb.alEstado('preparando', 0)

    let info
    try {
      info = await window.orbe.vozInfo()
    } catch {
      return this.aReposo('No he podido comprobar el dictado.')
    }
    if (!info.dictado) {
      return this.aReposo('El dictado no está configurado. Añade ORBE_STT_KEY (o ORBE_OPENAI_KEY) en el archivo .env y reinicia Orbe.')
    }
    if (this.descartar) return this.aReposo()

    try {
      this.flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      return this.aReposo(mensajeDeMicrofono(e))
    }
    // Se canceló mientras se abría: se suelta el micrófono sin grabar nada.
    if (this.descartar) return this.aReposo()

    this.trozos = []
    try {
      const tipo = elegirTipo()
      this.grabador = new MediaRecorder(this.flujo, tipo ? { mimeType: tipo } : undefined)
      this.grabador.ondataavailable = (ev) => {
        if (ev.data.size > 0) this.trozos.push(ev.data)
      }
      this.grabador.onstop = () => void this.alParar()
      this.grabador.start(250)
    } catch {
      return this.aReposo('No he podido empezar a grabar con ese micrófono.')
    }
    // Si el micrófono desaparece a media grabación (auriculares que se desconectan), se cierra con lo que haya.
    for (const pista of this.flujo.getTracks()) pista.onended = () => this.terminar()

    this.estado = 'grabando'
    this.inicio = Date.now()
    this.cb.alEstado('grabando', 0)
    this.reloj = window.setInterval(() => {
      const segundos = Math.floor((Date.now() - this.inicio) / 1000)
      this.cb.alEstado('grabando', segundos)
      if (segundos >= MAX_SEGUNDOS) this.terminar()
    }, 250)
  }

  /** Deja de grabar y manda el audio a transcribir. */
  terminar(): void {
    if (this.estado !== 'grabando') return
    if (this.grabador?.state === 'recording') this.grabador.stop()
    // El grabador ya se paró solo (falló el dispositivo): se cierra igualmente, para no quedarse «grabando».
    else void this.alParar()
  }

  /** Descarta la grabación en curso o la que se está abriendo (por ejemplo, con Esc): no se transcribe ni se envía nada. */
  cancelar(): void {
    if (this.estado !== 'grabando' && this.estado !== 'preparando') return
    this.descartar = true
    this.terminar()
  }

  private async alParar(): Promise<void> {
    if (this.estado !== 'grabando') return
    window.clearInterval(this.reloj)
    this.soltarMicrofono()
    const bruto = new Blob(this.trozos, { type: this.grabador?.mimeType || 'audio/webm' })
    this.trozos = []

    if (this.descartar || bruto.size < MIN_BYTES) {
      const descartada = this.descartar
      this.aReposo(descartada ? undefined : 'No he oído nada. Prueba otra vez, más cerca del micrófono.')
      return
    }

    this.estado = 'transcribiendo'
    this.cb.alEstado('transcribiendo', 0)
    try {
      const respuesta = await window.orbe.vozTranscribir(new Uint8Array(await bruto.arrayBuffer()), bruto.type || 'audio/webm')
      if (!respuesta.ok) this.cb.alError(respuesta.error.mensaje)
      else if (respuesta.texto) this.cb.alTexto(respuesta.texto)
      else this.cb.alError('No he entendido nada. Prueba otra vez, hablando algo más claro.')
    } catch {
      this.cb.alError('No he podido transcribir el audio.')
    } finally {
      this.estado = 'reposo'
      this.cb.alEstado('reposo', 0)
    }
  }
}
