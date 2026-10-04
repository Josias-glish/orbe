export type EstadoDictado = 'reposo' | 'grabando' | 'transcribiendo'

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

  get grabando(): boolean {
    return this.estado === 'grabando'
  }

  /** Un clic empieza a grabar; otro clic termina y transcribe. Durante la transcripción no hace nada. */
  async alternar(): Promise<void> {
    if (this.estado === 'reposo') await this.iniciar()
    else if (this.estado === 'grabando') this.terminar()
  }

  private async iniciar(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.cb.alError('Este equipo no permite grabar audio desde Orbe.')
      return
    }
    let info
    try {
      info = await window.orbe.vozInfo()
    } catch {
      this.cb.alError('No he podido comprobar el dictado.')
      return
    }
    if (!info.dictado) {
      this.cb.alError('El dictado no está configurado. Añade ORBE_STT_KEY (o ORBE_OPENAI_KEY) en el archivo .env y reinicia Orbe.')
      return
    }

    try {
      this.flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      this.cb.alError(mensajeDeMicrofono(e))
      return
    }

    this.trozos = []
    this.descartar = false
    const tipo = elegirTipo()
    this.grabador = new MediaRecorder(this.flujo, tipo ? { mimeType: tipo } : undefined)
    this.grabador.ondataavailable = (ev) => {
      if (ev.data.size > 0) this.trozos.push(ev.data)
    }
    this.grabador.onstop = () => void this.alParar()
    this.grabador.start(250)

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
    if (this.estado === 'grabando' && this.grabador?.state === 'recording') this.grabador.stop()
  }

  /** Descarta la grabación en curso (por ejemplo, con Esc): no se transcribe ni se envía nada. */
  cancelar(): void {
    if (this.estado !== 'grabando') return
    this.descartar = true
    this.terminar()
  }

  private async alParar(): Promise<void> {
    window.clearInterval(this.reloj)
    this.flujo?.getTracks().forEach((t) => t.stop())
    this.flujo = null
    const bruto = new Blob(this.trozos, { type: this.grabador?.mimeType || 'audio/webm' })
    this.trozos = []

    if (this.descartar || bruto.size < MIN_BYTES) {
      const descartada = this.descartar
      this.estado = 'reposo'
      this.cb.alEstado('reposo', 0)
      if (!descartada) this.cb.alError('No he oído nada. Prueba otra vez, más cerca del micrófono.')
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
