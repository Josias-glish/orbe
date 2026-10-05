/**
 * Lectura del protocolo `stream-json` del CLI de Claude (`claude -p --output-format stream-json`).
 * Cada línea de stdout es un objeto JSON; aquí se traducen a eventos pequeños y estables.
 */

export type EventoCli =
  | { k: 'inicio' }
  | { k: 'pensando' }
  | { k: 'texto'; delta: string }
  /** Mensaje completo del asistente, por si no llegaron deltas (respaldo). */
  | { k: 'mensaje_completo'; texto: string }
  | { k: 'reintento'; intento: number; maximo: number; estadoHttp: number | null; error: string }
  | { k: 'limite'; estado: string; reinicioSeg: number | null; tipo: string | null }
  | { k: 'error_mensaje'; codigo: string; texto: string }
  /** Claude pide usar una herramienta (con sus parámetros ya completos). */
  | { k: 'herramienta_pedida'; id: string; nombre: string; entrada: Record<string, unknown> }
  /** El resultado de una herramienta, que el CLI devuelve a Claude. */
  | { k: 'herramienta_resultado'; id: string; texto: string; error: boolean }
  | {
      k: 'resultado'
      error: boolean
      terminal: string | null
      parada: string | null
      estadoHttp: number | null
      texto: string
    }

/** Acumula trozos de stdout y devuelve las líneas completas (admite líneas partidas entre trozos). */
export class LectorLineas {
  private pendiente = ''

  alimentar(trozo: string): string[] {
    this.pendiente += trozo
    const lineas: string[] = []
    let corte: number
    while ((corte = this.pendiente.indexOf('\n')) >= 0) {
      const linea = this.pendiente.slice(0, corte).trim()
      this.pendiente = this.pendiente.slice(corte + 1)
      if (linea) lineas.push(linea)
    }
    return lineas
  }

  reiniciar(): void {
    this.pendiente = ''
  }
}

type Json = Record<string, unknown>

const esObjeto = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const comoTexto = (v: unknown): string => (typeof v === 'string' ? v : '')
const comoNumero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Traduce una línea del CLI a cero o más eventos. Las líneas que no son JSON o no interesan se ignoran. */
export function interpretarLinea(linea: string): EventoCli[] {
  let ev: unknown
  try {
    ev = JSON.parse(linea)
  } catch {
    return []
  }
  if (!esObjeto(ev)) return []

  switch (ev.type) {
    case 'system':
      return interpretarSistema(ev)
    case 'stream_event':
      return interpretarFlujo(ev)
    case 'assistant':
      return interpretarAsistente(ev)
    case 'user':
      return interpretarUsuario(ev)
    case 'rate_limit_event':
      return interpretarLimite(ev)
    case 'result':
      return [
        {
          k: 'resultado',
          error: ev.is_error === true,
          terminal: comoTexto(ev.terminal_reason) || null,
          parada: comoTexto(ev.stop_reason) || null,
          estadoHttp: comoNumero(ev.api_error_status),
          texto: comoTexto(ev.result)
        }
      ]
    default:
      return []
  }
}

function interpretarSistema(ev: Json): EventoCli[] {
  if (ev.subtype === 'init') return [{ k: 'inicio' }]
  if (ev.subtype === 'api_retry') {
    return [
      {
        k: 'reintento',
        intento: comoNumero(ev.attempt) ?? 1,
        maximo: comoNumero(ev.max_retries) ?? 1,
        estadoHttp: comoNumero(ev.error_status),
        error: comoTexto(ev.error)
      }
    ]
  }
  return []
}

function interpretarFlujo(ev: Json): EventoCli[] {
  const interno = ev.event
  if (!esObjeto(interno)) return []

  if (interno.type === 'content_block_start' && esObjeto(interno.content_block)) {
    const tipo = interno.content_block.type
    if (tipo === 'thinking' || tipo === 'redacted_thinking') return [{ k: 'pensando' }]
    return []
  }

  if (interno.type === 'content_block_delta' && esObjeto(interno.delta)) {
    const delta = interno.delta
    if (delta.type === 'text_delta') {
      const texto = comoTexto(delta.text)
      return texto ? [{ k: 'texto', delta: texto }] : []
    }
    if (delta.type === 'thinking_delta') return [{ k: 'pensando' }]
  }
  return []
}

function interpretarAsistente(ev: Json): EventoCli[] {
  const mensaje = ev.message
  if (!esObjeto(mensaje)) return []

  const codigoError = comoTexto(ev.error)
  const bloques = Array.isArray(mensaje.content) ? mensaje.content : []
  const texto = bloques
    .filter((b): b is Json => esObjeto(b) && b.type === 'text')
    .map((b) => comoTexto(b.text))
    .join('\n\n')

  // Los fallos (sin sesión, límite…) llegan como un mensaje «sintético» del asistente con un código de error.
  if (codigoError) return [{ k: 'error_mensaje', codigo: codigoError, texto }]
  if (mensaje.model === '<synthetic>') return []

  const eventos: EventoCli[] = []
  if (texto) eventos.push({ k: 'mensaje_completo', texto })
  // Una herramienta pedida (con los parámetros completos, que en el flujo de deltas llegan a trozos). Los subagentes
  // (parent_tool_use_id) no se cuentan: Orbe no los usa.
  if (ev.parent_tool_use_id == null) {
    for (const b of bloques) {
      if (esObjeto(b) && b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
        eventos.push({ k: 'herramienta_pedida', id: b.id, nombre: b.name, entrada: esObjeto(b.input) ? b.input : {} })
      }
    }
  }
  return eventos
}

/** Los resultados de herramientas llegan como un mensaje «de usuario» que el CLI le manda a Claude. */
function interpretarUsuario(ev: Json): EventoCli[] {
  const mensaje = ev.message
  if (!esObjeto(mensaje) || !Array.isArray(mensaje.content) || ev.parent_tool_use_id != null) return []
  const eventos: EventoCli[] = []
  for (const b of mensaje.content) {
    if (!esObjeto(b) || b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue
    const texto = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((c) => (esObjeto(c) ? comoTexto(c.text) : '')).join('') : ''
    eventos.push({ k: 'herramienta_resultado', id: b.tool_use_id, texto, error: b.is_error === true })
  }
  return eventos
}

function interpretarLimite(ev: Json): EventoCli[] {
  const info = ev.rate_limit_info
  if (!esObjeto(info)) return []
  return [
    {
      k: 'limite',
      estado: comoTexto(info.status),
      reinicioSeg: comoNumero(info.resetsAt),
      tipo: comoTexto(info.rateLimitType) || null
    }
  ]
}
