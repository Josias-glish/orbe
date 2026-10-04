import type { MotivoFin } from '../../shared/tipos'
import { construirBloques, type TurnoEntrada } from './contenido'
import { ErrorChat, crearError } from './errores'
import { construirPromptSistema } from './prompt-sistema'
import type { ManejadoresTurno, ProveedorChat, ResultadoTurno } from './proveedor'

export interface OpcionesProveedorOpenai {
  /** Dirección base de la API, p. ej. https://api.openai.com/v1 (o http://localhost:11434/v1 para Ollama). */
  url: string
  /** Puede estar vacía con servidores locales que no la piden. */
  clave: string
  modelo: string
  /** Bloque de memoria del usuario; se consulta al empezar cada conversación. */
  memoria?: () => string | undefined
  ahora?: () => Date
  /** Para pruebas. */
  fetch?: typeof fetch
  /** Tiempo máximo para recibir la primera respuesta del servidor. */
  conexionMaxMs?: number
  /** Silencio máximo del servidor durante una respuesta en curso. */
  silencioMaxMs?: number
}

type ParteTexto = { type: 'text'; text: string }
type ParteImagen = { type: 'image_url'; image_url: { url: string } }
interface MensajeApi {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<ParteTexto | ParteImagen>
}

/** Un trozo del flujo de la API: lo único que nos interesa son el texto, el motivo de fin y los errores. */
interface TrozoSse {
  choices?: Array<{ delta?: { content?: unknown }; finish_reason?: string | null }>
  error?: { message?: string }
}

const URL_OPENAI = 'api.openai.com'

/** Quita la barra final y el sufijo de la ruta si el usuario pegó la dirección completa. */
export function normalizarUrlBase(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
}

/** Contenido de un mensaje de usuario en el formato de la API: texto simple, o partes si lleva una captura. */
export function contenidoParaApi(entrada: TurnoEntrada): { completo: MensajeApi['content']; soloTexto: string } {
  const bloques = construirBloques(entrada)
  const texto = bloques
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
  const imagenes = bloques.filter((b) => b.type === 'image')
  if (imagenes.length === 0) return { completo: texto, soloTexto: texto }
  const partes: Array<ParteTexto | ParteImagen> = imagenes.map((b) => ({
    type: 'image_url' as const,
    image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` }
  }))
  partes.push({ type: 'text', text: texto })
  return { completo: partes, soloTexto: texto }
}

/** Traduce un fallo HTTP del servicio a un error claro para el usuario. */
export function errorDesdeHttp(estado: number, cuerpo: string): ErrorChat {
  let mensajeApi = ''
  try {
    const j = JSON.parse(cuerpo) as { error?: { message?: string } | string; message?: string }
    mensajeApi = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message ?? '')
  } catch {
    mensajeApi = cuerpo.slice(0, 300)
  }
  const detalle = `HTTP ${estado}${mensajeApi ? `: ${mensajeApi.slice(0, 400)}` : ''}`

  if (estado === 401)
    return new ErrorChat(crearError('clave_invalida', { mensaje: 'El servicio ha rechazado la clave. Revisa ORBE_OPENAI_KEY en el archivo .env.', detalle }))
  if (estado === 403) return new ErrorChat(crearError('cuenta', { detalle }))
  if (estado === 404 || (estado === 400 && /model/i.test(mensajeApi) && /(not found|does not exist|unknown|invalid)/i.test(mensajeApi)))
    return new ErrorChat(crearError('modelo', { mensaje: 'El modelo configurado no existe en ese servicio. Revisa ORBE_MODELO en .env.', detalle }))
  if (estado === 408 || estado === 504) return new ErrorChat(crearError('tiempo_agotado', { detalle }))
  if (estado === 429) {
    const cuota = /quota|billing|credit/i.test(mensajeApi)
    return new ErrorChat(
      crearError('limite_uso', {
        mensaje: cuota
          ? 'Tu cuenta no tiene saldo o cuota disponible en ese servicio. Revisa tu plan o tu facturación.'
          : 'Has hecho demasiadas peticiones seguidas. Espera un poco y vuelve a intentarlo.',
        detalle
      })
    )
  }
  if (estado >= 500) return new ErrorChat(crearError('sobrecarga', { detalle }))
  return new ErrorChat(
    crearError('solicitud_invalida', {
      mensaje: /image|vision/i.test(mensajeApi)
        ? 'Ese modelo no admite imágenes. Quita la captura o usa un modelo con visión.'
        : 'El servicio no ha aceptado la petición.',
      detalle
    })
  )
}

/**
 * Habla con cualquier servicio compatible con la API de «chat completions» de OpenAI: OpenAI, Groq, OpenRouter,
 * DeepSeek, y modelos locales (Ollama, LM Studio). La clave solo existe en el proceso principal. Como la API no
 * guarda estado, el historial de la conversación se conserva aquí y se reenvía entero (sin las capturas, que
 * pesan mucho: el modelo las ve en el mensaje en que se adjuntan).
 */
export class ProveedorOpenai implements ProveedorChat {
  readonly nombre = 'openai' as const
  readonly modelo: string

  private historial: MensajeApi[] = []
  private prompt: string | null = null
  private controlador: AbortController | null = null
  private turnoEnCurso = false

  constructor(private readonly opciones: OpcionesProveedorOpenai) {
    this.modelo = opciones.modelo
  }

  async enviar(entrada: TurnoEntrada, m: ManejadoresTurno): Promise<ResultadoTurno> {
    const { url, clave, modelo } = this.opciones
    if (!modelo) {
      throw new ErrorChat(crearError('solicitud_invalida', { mensaje: 'Falta el modelo. Define ORBE_MODELO en el archivo .env (por ejemplo gpt-4o-mini).' }))
    }
    if (!clave && new URL(normalizarUrlBase(url)).hostname.endsWith(URL_OPENAI)) {
      throw new ErrorChat(crearError('clave_invalida', { mensaje: 'Falta la clave. Define ORBE_OPENAI_KEY en el archivo .env.' }))
    }
    if (this.turnoEnCurso) {
      throw new ErrorChat(crearError('solicitud_invalida', { mensaje: 'Todavía estoy respondiendo al mensaje anterior.' }))
    }

    this.turnoEnCurso = true
    if (this.prompt === null || this.historial.length === 0) {
      this.prompt = construirPromptSistema({ ahora: this.opciones.ahora?.(), memoria: this.opciones.memoria?.() })
    }
    const controlador = new AbortController()
    this.controlador = controlador
    let vencio: 'conexion' | 'silencio' | null = null
    let reloj: NodeJS.Timeout | null = null
    const armar = (ms: number, motivo: 'conexion' | 'silencio'): void => {
      if (reloj) clearTimeout(reloj)
      reloj = setTimeout(() => {
        vencio = motivo
        controlador.abort()
      }, ms)
    }

    const { completo, soloTexto } = contenidoParaApi(entrada)
    let texto = ''
    let motivo: MotivoFin = 'completo'

    try {
      armar(this.opciones.conexionMaxMs ?? 30_000, 'conexion')
      const respuesta = await (this.opciones.fetch ?? fetch)(`${normalizarUrlBase(url)}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(clave ? { authorization: `Bearer ${clave}` } : {}) },
        body: JSON.stringify({
          model: modelo,
          stream: true,
          messages: [{ role: 'system', content: this.prompt }, ...this.historial, { role: 'user', content: completo }]
        }),
        signal: controlador.signal
      })
      if (!respuesta.ok) throw errorDesdeHttp(respuesta.status, await respuesta.text().catch(() => ''))
      if (!respuesta.body) throw new ErrorChat(crearError('desconocido', { detalle: 'La respuesta no trae contenido.' }))

      const lector = respuesta.body.getReader()
      const decodificador = new TextDecoder()
      let pendiente = ''
      let terminado = false
      armar(this.opciones.silencioMaxMs ?? 120_000, 'silencio')
      while (!terminado) {
        const { done, value } = await lector.read()
        if (done) break
        armar(this.opciones.silencioMaxMs ?? 120_000, 'silencio')
        pendiente += decodificador.decode(value, { stream: true })
        let corte: number
        while ((corte = pendiente.indexOf('\n')) >= 0) {
          const linea = pendiente.slice(0, corte).trim()
          pendiente = pendiente.slice(corte + 1)
          if (!linea.startsWith('data:')) continue
          const datos = linea.slice(5).trim()
          if (datos === '[DONE]') {
            terminado = true
            break
          }
          let trozo: TrozoSse
          try {
            trozo = JSON.parse(datos) as TrozoSse
          } catch {
            continue
          }
          if (trozo.error) throw errorDesdeHttp(500, JSON.stringify({ error: trozo.error }))
          const eleccion = trozo.choices?.[0]
          const delta = eleccion?.delta?.content
          if (typeof delta === 'string' && delta) {
            texto += delta
            m.alTexto(delta)
          }
          if (eleccion?.finish_reason === 'length') motivo = 'limite_tokens'
        }
      }

      this.historial.push({ role: 'user', content: soloTexto }, { role: 'assistant', content: texto })
      return { motivo }
    } catch (e) {
      if (e instanceof ErrorChat) throw e
      if (controlador.signal.aborted) {
        if (vencio === 'conexion') throw new ErrorChat(crearError('tiempo_agotado', { detalle: 'El servicio no respondió a tiempo.' }))
        if (vencio === 'silencio') throw new ErrorChat(crearError('tiempo_agotado', { detalle: 'El servicio dejó de responder.' }))
        // Cancelado por el usuario: lo que ya se mostró forma parte de la conversación.
        if (texto) this.historial.push({ role: 'user', content: soloTexto }, { role: 'assistant', content: texto })
        return { motivo: 'cancelado' }
      }
      throw new ErrorChat(crearError('sin_conexion', { detalle: e instanceof Error ? e.message : String(e) }))
    } finally {
      if (reloj) clearTimeout(reloj)
      this.turnoEnCurso = false
      this.controlador = null
    }
  }

  cancelar(): void {
    this.controlador?.abort()
  }

  reiniciar(): void {
    this.cancelar()
    this.historial = []
    this.prompt = null
  }

  cerrar(): void {
    this.cancelar()
  }
}
