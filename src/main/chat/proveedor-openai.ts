import type { MotivoFin } from '../../shared/tipos'
import { ejecutarBucle, type RespuestaPaso } from '../agente/bucle'
import { agenteActivo, crearEjecutor, hayBusquedaWeb, type OpcionesAgente } from '../agente/sesion'
import type { LlamadaHerramienta, ResultadoLlamada } from '../agente/tipos'
import { construirBloques, type TurnoEntrada } from './contenido'
import { ErrorChat, crearError } from './errores'
import { construirPromptSistema } from './prompt-sistema'
import type { Esfuerzo, ManejadoresTurno, ProveedorChat, ResultadoTurno } from './proveedor'

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
  /** Herramientas para actuar (modo agente). Sin ellas, el chat funciona como siempre. */
  agente?: OpcionesAgente
}

type ParteTexto = { type: 'text'; text: string }
type ParteImagen = { type: 'image_url'; image_url: { url: string } }

/** Una herramienta que pidió el modelo, en el formato de «chat completions». */
interface LlamadaApi {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface MensajeApi {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<ParteTexto | ParteImagen>
  /** Solo en el mensaje del asistente que pide herramientas. */
  tool_calls?: LlamadaApi[]
  /** Solo en los mensajes `tool`: a qué llamada responden. */
  tool_call_id?: string
}

/** Un trozo del flujo de la API: lo único que nos interesa son el texto, las herramientas, el motivo de fin y los errores. */
interface TrozoSse {
  choices?: Array<{
    delta?: {
      content?: unknown
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>
    }
    finish_reason?: string | null
  }>
  error?: { message?: string }
}

const URL_OPENAI = 'api.openai.com'

/** Cómo suena un servicio cuando no conoce un parámetro de la petición (p. ej. `reasoning_effort`). */
const MENSAJE_PARAMETRO_NO_ADMITIDO =
  /reasoning|effort|unrecogni[sz]ed (request )?(argument|field|parameter)|unknown (field|parameter|argument)|extra (fields|inputs|parameters)|additional propert|unexpected (field|keyword|parameter)/i

/** Cómo suena un servicio cuando no admite herramientas (llamadas a funciones). Se mira antes que el parámetro de esfuerzo. */
const MENSAJE_HERRAMIENTAS_NO_ADMITIDAS = /\btools?\b|tool[_ ]choice|function[_ ]call/i

/** El marcador de potencia de Orbe tiene cinco niveles; los servicios compatibles con OpenAI, tres. */
export function esfuerzoParaServicio(nivel: Esfuerzo): 'low' | 'medium' | 'high' {
  return nivel === 'low' ? 'low' : nivel === 'medium' ? 'medium' : 'high'
}

/** Lo que se deja en el historial cuando el usuario detiene una tarea, para que los turnos sigan alternando bien. */
export const MARCA_DETENIDO = '[La tarea se detuvo por orden del usuario.]'
const OMITIDO = '[Resultado anterior omitido para ahorrar espacio.]'
/** Cuántos resultados de herramientas se conservan enteros; los anteriores largos se recortan. */
const RESULTADOS_CONSERVADOS = 4
const UMBRAL_RECORTE = 1500

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
        : /tool|function/i.test(mensajeApi)
          ? 'Ese modelo o servicio no admite herramientas. Apaga el modo agente (ORBE_AGENTE=0) o usa un modelo con llamadas a funciones.'
          : 'El servicio no ha aceptado la petición.',
      detalle
    })
  )
}

/** Lo que dio una petición: el texto, las herramientas pedidas (aún con los parámetros sin interpretar) y el motivo de fin. */
interface RespuestaFlujo {
  llamadas: Array<{ id: string; nombre: string; argumentos: string }>
  fin: string | null
}

/** Pasa los parámetros que mandó el modelo (texto) a un objeto; si no son JSON, la llamada lleva el error. */
function aLlamada(l: { id: string; nombre: string; argumentos: string }, n: number): LlamadaHerramienta {
  const id = l.id || `llamada-${n}`
  if (l.argumentos.trim() === '') return { id, nombre: l.nombre, entrada: {} }
  try {
    return { id, nombre: l.nombre, entrada: JSON.parse(l.argumentos) as unknown }
  } catch (e) {
    return { id, nombre: l.nombre, entrada: null, errorEntrada: e instanceof Error ? e.message : 'JSON no válido' }
  }
}

/**
 * Deja el historial válido tras detener una tarea: si el último mensaje del asistente pidió herramientas, se
 * contestan todas (con lo que ya se obtuvo o como «cancelado») y se cierra con una marca del asistente.
 */
export function repararHistorialCancelado(mensajes: MensajeApi[], pendientes: ResultadoLlamada[]): void {
  const ultimo = mensajes[mensajes.length - 1]
  if (ultimo?.role === 'assistant' && ultimo.tool_calls?.length) {
    const porId = new Map(pendientes.map((p) => [p.id, p]))
    for (const l of ultimo.tool_calls) {
      const r = porId.get(l.id)
      mensajes.push({ role: 'tool', tool_call_id: l.id, content: r?.contenido ?? 'Cancelado por el usuario.' })
    }
  }
  mensajes.push({ role: 'assistant', content: MARCA_DETENIDO })
}

/** Recorta los resultados largos de herramientas antiguos: el modelo ya los usó y no hace falta reenviarlos enteros. */
export function compactarResultadosAntiguos(mensajes: MensajeApi[]): void {
  const indices = mensajes.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0)
  for (const i of indices.slice(0, Math.max(0, indices.length - RESULTADOS_CONSERVADOS))) {
    const m = mensajes[i]
    if (typeof m.content === 'string' && m.content.length > UMBRAL_RECORTE) mensajes[i] = { ...m, content: OMITIDO }
  }
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
  /** Solo los modelos con niveles de razonamiento (o1, gpt-5, gpt-oss…) hacen caso: depende del servicio. */
  readonly aplicaEsfuerzo = 'segun_servicio' as const

  private esfuerzo: Esfuerzo = 'medium'
  /** El servicio rechazó `reasoning_effort`: no se le vuelve a mandar. */
  private esfuerzoNoAdmitido = false
  /** El servicio rechazó las herramientas: desde entonces solo conversa (no hay agente). */
  private herramientasNoAdmitidas = false
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
    const agente = agenteActivo(this.opciones.agente) && !this.herramientasNoAdmitidas ? this.opciones.agente : undefined
    if (this.prompt === null || this.historial.length === 0) {
      this.prompt = construirPromptSistema({
        ahora: this.opciones.ahora?.(),
        memoria: this.opciones.memoria?.(),
        pasosAgente: agente?.maxPasos,
        busquedaWeb: agente ? hayBusquedaWeb(agente) : undefined
      })
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
    const acumulado = { texto: '' }

    try {
      if (agente) return await this.turnoAgente(agente, completo, soloTexto, m, controlador, armar)

      const r = await this.pedir(
        [{ role: 'system', content: this.prompt }, ...this.historial, { role: 'user', content: completo }],
        undefined,
        m,
        controlador,
        armar,
        acumulado
      )
      this.historial.push({ role: 'user', content: soloTexto }, { role: 'assistant', content: acumulado.texto })
      const motivo: MotivoFin = r.fin === 'length' ? 'limite_tokens' : 'completo'
      return { motivo }
    } catch (e) {
      if (e instanceof ErrorChat) throw e
      if (controlador.signal.aborted) {
        if (vencio === 'conexion') throw new ErrorChat(crearError('tiempo_agotado', { detalle: 'El servicio no respondió a tiempo.' }))
        if (vencio === 'silencio') throw new ErrorChat(crearError('tiempo_agotado', { detalle: 'El servicio dejó de responder.' }))
        // Cancelado por el usuario: lo que ya se mostró forma parte de la conversación.
        if (!agente && acumulado.texto) {
          this.historial.push({ role: 'user', content: soloTexto }, { role: 'assistant', content: acumulado.texto })
        }
        return { motivo: 'cancelado' }
      }
      throw new ErrorChat(crearError('sin_conexion', { detalle: e instanceof Error ? e.message : String(e) }))
    } finally {
      if (reloj) clearTimeout(reloj)
      this.turnoEnCurso = false
      this.controlador = null
    }
  }

  /**
   * Una petición al servicio: manda los mensajes (y las herramientas, si se ofrecen), va entregando el texto a
   * medida que llega y devuelve las herramientas pedidas y el motivo de fin. `acumulado.texto` va creciendo para
   * que, si se cancela a medias, quien llama sepa lo que ya se mostró.
   */
  private async pedir(
    mensajes: MensajeApi[],
    herramientas: { definiciones: unknown[]; ninguna: boolean } | undefined,
    m: ManejadoresTurno,
    controlador: AbortController,
    armar: (ms: number, motivo: 'conexion' | 'silencio') => void,
    acumulado: { texto: string }
  ): Promise<RespuestaFlujo> {
    const { url, clave, modelo } = this.opciones
    const llamar = (conEsfuerzo: boolean, conHerramientas: boolean): Promise<Response> => {
      armar(this.opciones.conexionMaxMs ?? 30_000, 'conexion')
      return (this.opciones.fetch ?? fetch)(`${normalizarUrlBase(url)}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(clave ? { authorization: `Bearer ${clave}` } : {}) },
        body: JSON.stringify({
          model: modelo,
          stream: true,
          messages: mensajes,
          ...(herramientas && conHerramientas ? { tools: herramientas.definiciones, ...(herramientas.ninguna ? { tool_choice: 'none' } : {}) } : {}),
          ...(conEsfuerzo ? { reasoning_effort: esfuerzoParaServicio(this.esfuerzo) } : {})
        }),
        signal: controlador.signal
      })
    }

    // El marcador de potencia solo se manda si se ha movido del punto medio; si el servicio lo rechaza, se sigue sin él.
    let conEsfuerzo = !this.esfuerzoNoAdmitido && this.esfuerzo !== 'medium'
    let conHerramientas = herramientas !== undefined
    let respuesta = await llamar(conEsfuerzo, conHerramientas)
    // Un servicio que no entiende un parámetro suele contestar 400 (o 422): se aparta el culpable y se repite.
    for (let intento = 0; intento < 2 && !respuesta.ok && (respuesta.status === 400 || respuesta.status === 422); intento++) {
      const cuerpo = await respuesta.text().catch(() => '')
      if (conHerramientas && MENSAJE_HERRAMIENTAS_NO_ADMITIDAS.test(cuerpo)) {
        // Sin herramientas no hay agente: se sigue como chat normal, y las siguientes conversaciones también.
        this.herramientasNoAdmitidas = true
        this.prompt = null
        conHerramientas = false
        m.alAviso?.('Este modelo o servicio no admite herramientas: sigo solo conversando, sin buscar ni abrir nada.')
      } else if (conEsfuerzo && MENSAJE_PARAMETRO_NO_ADMITIDO.test(cuerpo)) {
        this.esfuerzoNoAdmitido = true
        conEsfuerzo = false
        m.alAviso?.('Este servicio no admite niveles de potencia: sigo con el nivel normal del modelo.')
      } else {
        throw errorDesdeHttp(respuesta.status, cuerpo)
      }
      respuesta = await llamar(conEsfuerzo, conHerramientas)
    }
    if (!respuesta.ok) throw errorDesdeHttp(respuesta.status, await respuesta.text().catch(() => ''))
    if (!respuesta.body) throw new ErrorChat(crearError('desconocido', { detalle: 'La respuesta no trae contenido.' }))

    const lector = respuesta.body.getReader()
    const decodificador = new TextDecoder()
    let pendiente = ''
    let terminado = false
    let fin: string | null = null
    const llamadas: RespuestaFlujo['llamadas'] = []
    const porIndice = new Map<number, RespuestaFlujo['llamadas'][number]>()
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
          acumulado.texto += delta
          m.alTexto(delta)
        }
        for (const tc of eleccion?.delta?.tool_calls ?? []) {
          // Los argumentos llegan en trozos: se juntan por `index` (o, si el servicio no lo manda, en la última llamada).
          let actual = tc.index !== undefined ? porIndice.get(tc.index) : undefined
          if (!actual && tc.index === undefined && !tc.id && llamadas.length > 0) actual = llamadas[llamadas.length - 1]
          if (!actual) {
            actual = { id: tc.id ?? '', nombre: '', argumentos: '' }
            llamadas.push(actual)
            if (tc.index !== undefined) porIndice.set(tc.index, actual)
          }
          if (tc.id && !actual.id) actual.id = tc.id
          if (tc.function?.name && !actual.nombre) actual.nombre = tc.function.name
          if (tc.function?.arguments) actual.argumentos += tc.function.arguments
        }
        if (eleccion?.finish_reason) fin = eleccion.finish_reason
      }
    }
    return { llamadas, fin }
  }

  /**
   * Un turno con herramientas: el modelo pide una, la aplicación la ejecuta y le devuelve el resultado, hasta que
   * responde sin pedir más. El historial guarda las peticiones (`tool_calls`) y los resultados (`tool`).
   */
  private async turnoAgente(
    agente: OpcionesAgente,
    completo: MensajeApi['content'],
    soloTexto: string,
    m: ManejadoresTurno,
    controlador: AbortController,
    armar: (ms: number, motivo: 'conexion' | 'silencio') => void
  ): Promise<ResultadoTurno> {
    const mensajes: MensajeApi[] = [...this.historial, { role: 'user', content: soloTexto }]
    const posUsuario = mensajes.length - 1
    const ejecutor = crearEjecutor(agente, controlador.signal, m)
    const definiciones = agente.registro.paraOpenai()
    let primera = true

    const resultado = await ejecutarBucle({
      maxPasos: agente.maxPasos,
      senal: controlador.signal,
      ejecutar: (llamada) => ejecutor.ejecutar(llamada),
      paso: async (resultados, modo): Promise<RespuestaPaso> => {
        for (const r of resultados ?? []) mensajes.push({ role: 'tool', tool_call_id: r.id, content: r.contenido })
        compactarResultadosAntiguos(mensajes)
        // La captura (si la hay) solo viaja en la primera petición; el historial guarda el texto.
        const enviados = primera ? mensajes.map((msg, i) => (i === posUsuario ? { ...msg, content: completo } : msg)) : mensajes
        primera = false
        const acumulado = { texto: '' }
        const r = await this.pedir(
          [{ role: 'system', content: this.prompt as string }, ...enviados],
          { definiciones, ninguna: modo.sinHerramientas },
          m,
          controlador,
          armar,
          acumulado
        )

        const cortada = r.fin === 'length'
        // Una petición de herramienta cortada a medias no se puede reenviar: se descarta.
        const pedidas = cortada || modo.sinHerramientas ? [] : r.llamadas.filter((l) => l.nombre)
        const llamadas = pedidas.map(aLlamada)
        mensajes.push(
          llamadas.length > 0
            ? {
                role: 'assistant',
                content: acumulado.texto,
                tool_calls: llamadas.map((l, i) => ({
                  id: l.id,
                  type: 'function' as const,
                  function: { name: l.nombre, arguments: pedidas[i].argumentos || '{}' }
                }))
              }
            : { role: 'assistant', content: acumulado.texto }
        )
        if (cortada) return { fin: 'limite_tokens', llamadas: [] }
        return llamadas.length > 0 ? { fin: 'herramientas', llamadas } : { fin: 'completo', llamadas: [] }
      }
    })

    if (resultado.motivo === 'cancelado') repararHistorialCancelado(mensajes, resultado.pendientes)
    this.historial = mensajes
    return { motivo: resultado.motivo }
  }

  establecerEsfuerzo(nivel: Esfuerzo): void {
    this.esfuerzo = nivel
    // Un cambio del usuario merece otro intento aunque antes el servicio lo rechazara (quizá cambió de modelo).
    this.esfuerzoNoAdmitido = false
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
