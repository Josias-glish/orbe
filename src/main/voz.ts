import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { CANALES, type InfoVoz, type ResultadoDictado, type ResultadoSintesis } from '../shared/tipos'
import { ErrorChat, aErrorOrbe, crearError } from './chat/errores'
import { errorDesdeHttp, normalizarUrlBase } from './chat/proveedor-openai'

export const MAX_BYTES_AUDIO = 20 * 1024 * 1024
const MIME_PERMITIDO = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|wave|flac|m4a|x-m4a)\s*(;.*)?$/i

export interface OpcionesDictado {
  disponible: boolean
  url: string
  clave: string
  modelo: string
  idioma: string
  /** Para pruebas. */
  fetch?: typeof fetch
  timeoutMs?: number
}

export interface OpcionesSintesis {
  disponible: boolean
  url: string
  clave: string
  modelo: string
  voz: string
  /** Cómo hablar (tono, ritmo, carácter). Solo lo admiten los modelos gpt-4o-*-tts. */
  instrucciones: string
  fetch?: typeof fetch
  timeoutMs?: number
}

/** Extensión que el servicio de transcripción espera según el tipo del audio. */
export function extensionDeMime(mime: string): string {
  const tipo = mime.split(';')[0].trim().toLowerCase().replace('audio/', '')
  return { webm: 'webm', ogg: 'ogg', mp4: 'mp4', mpeg: 'mp3', mp3: 'mp3', wav: 'wav', 'x-wav': 'wav', wave: 'wav', flac: 'flac', m4a: 'm4a', 'x-m4a': 'm4a' }[tipo] ?? 'webm'
}

/**
 * Pasa la voz a texto con cualquier servicio compatible con `/audio/transcriptions` de OpenAI (OpenAI, Groq, un
 * Whisper local…). El audio solo sale cuando el usuario ha grabado y pulsado para terminar, y la clave solo
 * existe en el proceso principal.
 */
export class ServicioDictado {
  constructor(private readonly o: OpcionesDictado) {}

  info(): Pick<InfoVoz, 'dictado' | 'modelo' | 'idioma'> {
    return { dictado: this.o.disponible, modelo: this.o.modelo, idioma: this.o.idioma }
  }

  async transcribir(audio: Uint8Array, mime: string): Promise<string> {
    if (!this.o.disponible) {
      throw new ErrorChat(crearError('solicitud_invalida', { mensaje: 'El dictado no está configurado. Define ORBE_STT_KEY (o ORBE_OPENAI_KEY) en el archivo .env.' }))
    }
    if (audio.byteLength === 0) throw new ErrorChat(crearError('solicitud_invalida', { mensaje: 'No se ha grabado nada de audio.' }))
    if (audio.byteLength > MAX_BYTES_AUDIO) {
      throw new ErrorChat(crearError('solicitud_invalida', { mensaje: 'El audio es demasiado largo. Prueba con una grabación más corta.' }))
    }
    if (!MIME_PERMITIDO.test(mime)) throw new ErrorChat(crearError('solicitud_invalida', { mensaje: 'Ese formato de audio no se puede transcribir.' }))

    const formulario = new FormData()
    formulario.append('file', new Blob([audio], { type: mime.split(';')[0].trim() }), `audio.${extensionDeMime(mime)}`)
    formulario.append('model', this.o.modelo)
    if (this.o.idioma) formulario.append('language', this.o.idioma)
    formulario.append('response_format', 'json')

    const controlador = new AbortController()
    const reloj = setTimeout(() => controlador.abort(), this.o.timeoutMs ?? 60_000)
    try {
      const respuesta = await (this.o.fetch ?? fetch)(`${normalizarUrlBase(this.o.url)}/audio/transcriptions`, {
        method: 'POST',
        headers: this.o.clave ? { authorization: `Bearer ${this.o.clave}` } : {},
        body: formulario,
        signal: controlador.signal
      })
      const cuerpo = await respuesta.text()
      if (!respuesta.ok) {
        if (respuesta.status === 401) {
          throw new ErrorChat(crearError('clave_invalida', { mensaje: 'El servicio de dictado ha rechazado la clave. Revisa ORBE_STT_KEY en el archivo .env.', detalle: `HTTP 401` }))
        }
        if (respuesta.status === 413) throw new ErrorChat(crearError('solicitud_invalida', { mensaje: 'El audio es demasiado largo para el servicio.', detalle: 'HTTP 413' }))
        throw errorDesdeHttp(respuesta.status, cuerpo)
      }
      try {
        const j = JSON.parse(cuerpo) as { text?: unknown }
        return typeof j.text === 'string' ? j.text.trim() : ''
      } catch {
        return cuerpo.trim() // algunos servidores devuelven texto plano
      }
    } catch (e) {
      if (e instanceof ErrorChat) throw e
      if (controlador.signal.aborted) throw new ErrorChat(crearError('tiempo_agotado', { detalle: 'El servicio de dictado no respondió a tiempo.' }))
      throw new ErrorChat(crearError('sin_conexion', { detalle: e instanceof Error ? e.message : String(e) }))
    } finally {
      clearTimeout(reloj)
    }
  }
}

/** Una frase como mucho: la API admite 4096 caracteres, pero cada petición es una frase suelta para empezar a hablar pronto. */
export const MAX_CARACTERES_SINTESIS = 1000

/**
 * Convierte frases en audio con una voz neuronal de un servicio compatible con `/audio/speech` de OpenAI. Solo se usa
 * si el usuario eligió la voz neuronal en el menú de voz: entonces el texto de las respuestas viaja a ese servicio.
 */
export class ServicioSintesis {
  constructor(private readonly o: OpcionesSintesis) {}

  info(): Pick<InfoVoz, 'neuronal' | 'vozNeuronal'> {
    return { neuronal: this.o.disponible, vozNeuronal: this.o.voz }
  }

  async sintetizar(texto: string): Promise<{ audio: Uint8Array; mime: string }> {
    if (!this.o.disponible) {
      throw new ErrorChat(crearError('solicitud_invalida', { mensaje: 'La voz neuronal no está configurada. Define ORBE_TTS_KEY (o ORBE_OPENAI_KEY) en el archivo .env.' }))
    }
    const limpio = texto.trim()
    if (!limpio) throw new ErrorChat(crearError('solicitud_invalida', { mensaje: 'No hay nada que decir.' }))
    if (limpio.length > MAX_CARACTERES_SINTESIS) throw new ErrorChat(crearError('solicitud_invalida', { mensaje: 'La frase es demasiado larga para la voz.' }))

    // Las instrucciones de estilo solo las admiten los modelos gpt-4o-*-tts; con tts-1 darían error.
    const admiteInstrucciones = /gpt-4o.*tts/i.test(this.o.modelo) && this.o.instrucciones.trim() !== ''
    const controlador = new AbortController()
    const reloj = setTimeout(() => controlador.abort(), this.o.timeoutMs ?? 30_000)
    try {
      const respuesta = await (this.o.fetch ?? fetch)(`${normalizarUrlBase(this.o.url)}/audio/speech`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.o.clave ? { authorization: `Bearer ${this.o.clave}` } : {}) },
        body: JSON.stringify({
          model: this.o.modelo,
          voice: this.o.voz,
          input: limpio,
          response_format: 'mp3',
          ...(admiteInstrucciones ? { instructions: this.o.instrucciones } : {})
        }),
        signal: controlador.signal
      })
      if (!respuesta.ok) {
        const cuerpo = await respuesta.text().catch(() => '')
        if (respuesta.status === 401) {
          throw new ErrorChat(crearError('clave_invalida', { mensaje: 'El servicio de voz ha rechazado la clave. Revisa ORBE_TTS_KEY en el archivo .env.', detalle: 'HTTP 401' }))
        }
        throw errorDesdeHttp(respuesta.status, cuerpo)
      }
      const audio = new Uint8Array(await respuesta.arrayBuffer())
      if (audio.byteLength === 0) throw new ErrorChat(crearError('desconocido', { detalle: 'El servicio de voz no devolvió audio.' }))
      return { audio, mime: respuesta.headers.get('content-type')?.split(';')[0].trim() || 'audio/mpeg' }
    } catch (e) {
      if (e instanceof ErrorChat) throw e
      if (controlador.signal.aborted) throw new ErrorChat(crearError('tiempo_agotado', { detalle: 'El servicio de voz no respondió a tiempo.' }))
      throw new ErrorChat(crearError('sin_conexion', { detalle: e instanceof Error ? e.message : String(e) }))
    } finally {
      clearTimeout(reloj)
    }
  }
}

/** Conecta el dictado y la voz neuronal del panel con sus servicios. */
export function registrarVoz(ventana: BrowserWindow, dictado: ServicioDictado, sintesis: ServicioSintesis): void {
  const exigir = (e: IpcMainInvokeEvent): void => {
    if (e.sender !== ventana.webContents) throw new Error('Remitente no autorizado')
  }
  ipcMain.handle(CANALES.vozInfo, (e): InfoVoz => {
    exigir(e)
    return { ...dictado.info(), ...sintesis.info() }
  })
  ipcMain.handle(CANALES.vozTranscribir, async (e, audio: unknown, mime: unknown): Promise<ResultadoDictado> => {
    exigir(e)
    const bytes = ArrayBuffer.isView(audio)
      ? new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength)
      : audio instanceof ArrayBuffer
        ? new Uint8Array(audio)
        : null
    if (!bytes || typeof mime !== 'string' || mime.length > 100) {
      return { ok: false, error: crearError('solicitud_invalida', { mensaje: 'El audio no es válido.' }) }
    }
    try {
      return { ok: true, texto: await dictado.transcribir(bytes, mime) }
    } catch (error) {
      return { ok: false, error: aErrorOrbe(error) }
    }
  })
  ipcMain.handle(CANALES.vozSintetizar, async (e, texto: unknown): Promise<ResultadoSintesis> => {
    exigir(e)
    if (typeof texto !== 'string') return { ok: false, error: crearError('solicitud_invalida', { mensaje: 'El texto no es válido.' }) }
    try {
      return { ok: true, ...(await sintesis.sintetizar(texto)) }
    } catch (error) {
      return { ok: false, error: aErrorOrbe(error) }
    }
  })
}
