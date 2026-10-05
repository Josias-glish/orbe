// CLI de Claude de mentira para las pruebas: habla el mismo protocolo stream-json que `claude -p`.
// El comportamiento depende del texto del mensaje del usuario (ver `manejarMensaje`).
import { createInterface } from 'node:readline'

const salida = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

let turnos = 0
let interrumpido = false
let ignorarInterrupciones = false
const memoria = []

const delta = (texto) =>
  salida({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: texto } } })

const resultado = (extra = {}) =>
  salida({
    type: 'result',
    subtype: 'success',
    is_error: false,
    stop_reason: 'end_turn',
    terminal_reason: 'completed',
    api_error_status: null,
    result: '',
    ...extra
  })

function inicioTurno() {
  salida({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5', cwd: process.cwd() })
  salida({ type: 'stream_event', event: { type: 'message_start', message: { model: 'claude-sonnet-5-5', content: [] } } })
}

const textoDe = (mensaje) =>
  (Array.isArray(mensaje.content) ? mensaje.content : [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')

/**
 * Habla con el servidor MCP de Orbe como lo hace el CLI real: lee `--mcp-config`, sustituye ${ORBE_MCP_TOKEN} en las
 * cabeceras con la variable de entorno, inicializa y llama a la herramienta. Devuelve el texto del resultado.
 */
let sesionMcp = null
async function llamarMcp(nombre, argumentos) {
  const i = process.argv.indexOf('--mcp-config')
  if (i < 0) return { texto: 'SIN_MCP', esError: true }
  const servidor = JSON.parse(process.argv[i + 1]).mcpServers.orbe
  const token = process.env.ORBE_MCP_TOKEN
  const cabeceras = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  for (const [k, v] of Object.entries(servidor.headers ?? {})) cabeceras[k] = String(v).replace('${ORBE_MCP_TOKEN}', token ?? '')
  const enviar = async (cuerpo) => {
    const r = await fetch(servidor.url, { method: 'POST', headers: cabeceras, body: JSON.stringify({ jsonrpc: '2.0', ...cuerpo }) })
    return { estado: r.status, json: r.status === 200 ? await r.json() : null }
  }
  if (!sesionMcp) {
    const sondeo = await enviar({ id: 'server-discover-probe-1', method: 'server/discover', params: {} })
    if (sondeo.estado !== 200 || !sondeo.json?.error) return { texto: `SONDEO_RARO ${sondeo.estado}`, esError: true }
    const ini = await enviar({ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.1.289' } } })
    if (ini.estado !== 200) return { texto: `HTTP ${ini.estado}`, esError: true }
    await enviar({ method: 'notifications/initialized' })
    const lista = await enviar({ id: 2, method: 'tools/list' })
    sesionMcp = { herramientas: lista.json.result.tools.map((t) => t.name) }
  }
  if (!sesionMcp.herramientas.includes(nombre)) return { texto: `HERRAMIENTA_DESCONOCIDA ${nombre}`, esError: true }
  const r = await enviar({ id: 3, method: 'tools/call', params: { name: nombre, arguments: argumentos } })
  if (r.estado !== 200) return { texto: `HTTP ${r.estado}`, esError: true }
  const res = r.json.result
  return { texto: res.content.map((c) => c.text).join(''), esError: res.isError === true }
}

async function manejarMensaje(mensaje) {
  turnos++
  interrumpido = false
  const texto = textoDe(mensaje)
  const hayImagen = mensaje.content.some((b) => b.type === 'image')
  inicioTurno()

  if (texto.includes('CRASH')) {
    process.stderr.write('boom: fallo interno\n')
    process.exit(3)
  }

  if (texto.includes('ERR_AUTH')) {
    salida({
      type: 'assistant',
      error: 'authentication_failed',
      message: { model: '<synthetic>', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] }
    })
    resultado({ is_error: true, stop_reason: 'stop_sequence', terminal_reason: 'api_error', result: 'Not logged in · Please run /login' })
    process.exit(1)
  }

  if (texto.includes('ERR_LIMITE')) {
    salida({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 3600, rateLimitType: 'five_hour' } })
    salida({
      type: 'assistant',
      error: 'rate_limit',
      message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your limit" }] }
    })
    resultado({ is_error: true, terminal_reason: 'api_error', result: "You've hit your limit" })
    return
  }

  if (texto.includes('SIN_RED')) {
    // Reintentos sin fin hasta que nos interrumpan, como el CLI real sin conexión.
    for (let intento = 1; intento <= 10 && !interrumpido; intento++) {
      salida({ type: 'system', subtype: 'api_retry', attempt: intento, max_retries: 10, retry_delay_ms: 20, error_status: null, error: 'unknown' })
      await esperar(25)
    }
    resultado({ subtype: 'error_during_execution', is_error: true, stop_reason: null, terminal_reason: 'aborted_streaming' })
    return
  }

  if (texto.includes('SATURADO')) {
    for (let intento = 1; intento <= 10 && !interrumpido; intento++) {
      salida({ type: 'system', subtype: 'api_retry', attempt: intento, max_retries: 10, retry_delay_ms: 20, error_status: 529, error: 'overloaded' })
      await esperar(25)
    }
    resultado({ subtype: 'error_during_execution', is_error: true, stop_reason: null, terminal_reason: 'aborted_streaming' })
    return
  }

  if (texto.includes('CUELGA')) {
    // No contesta a nada, ni siquiera a las interrupciones.
    ignorarInterrupciones = true
    await esperar(60_000)
    return
  }

  if (texto.includes('LARGO')) {
    for (let i = 0; i < 400 && !interrumpido; i++) {
      delta(`palabra${i} `)
      await esperar(15)
    }
    if (interrumpido) resultado({ subtype: 'error_during_execution', is_error: true, stop_reason: null, terminal_reason: 'aborted_streaming' })
    else resultado()
    return
  }

  if (texto.includes('PENSAR')) {
    salida({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } })
    salida({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'mmm' } } })
    salida({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } })
    delta('Listo.')
    resultado()
    return
  }

  if (texto.includes('SOLO_MENSAJE')) {
    salida({ type: 'assistant', message: { model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Respuesta sin deltas' }] } })
    resultado()
    return
  }

  if (texto.includes('REFUSAL')) {
    delta('No puedo.')
    resultado({ stop_reason: 'refusal' })
    return
  }

  if (texto.includes('TRUNCADO')) {
    delta('Cortado')
    resultado({ stop_reason: 'max_tokens' })
    return
  }

  // Herramientas de Orbe por MCP: «MCP:nombre:{json}|nombre:{json}» las pide una detrás de otra; «MCP_PARALELO:…» a la vez.
  if (texto.startsWith('MCP:') || texto.startsWith('MCP_PARALELO:')) {
    const paralelo = texto.startsWith('MCP_PARALELO:')
    const peticiones = texto
      .slice(texto.indexOf(':') + 1)
      .split('|')
      .map((p) => {
        const i = p.indexOf(':')
        return { nombre: p.slice(0, i), argumentos: JSON.parse(p.slice(i + 1)) }
      })
    const resultados = []
    const usar = async (p, n) => {
      const id = `toolu_${turnos}_${n}`
      salida({
        type: 'assistant',
        message: { model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id, name: `mcp__orbe__${p.nombre}`, input: p.argumentos }] }
      })
      const r = await llamarMcp(p.nombre, p.argumentos)
      salida({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: r.texto }], ...(r.esError ? { is_error: true } : {}) }] } })
      resultados.push(r)
    }
    if (paralelo) await Promise.all(peticiones.map(usar))
    else for (const [n, p] of peticiones.entries()) if (!interrumpido) await usar(p, n)
    if (interrumpido) {
      resultado({ subtype: 'error_during_execution', is_error: true, stop_reason: null, terminal_reason: 'aborted_streaming' })
      return
    }
    const resumen = `Listo: ${resultados.map((r) => `${r.esError ? 'ERROR ' : ''}${r.texto}`).join(' || ')}`
    delta(resumen)
    salida({ type: 'assistant', message: { model: 'claude-sonnet-5-5', content: [{ type: 'text', text: resumen }] } })
    resultado({ result: resumen })
    return
  }

  // La búsqueda web que trae el propio CLI: «WEBSEARCH:consulta».
  if (texto.startsWith('WEBSEARCH:')) {
    const consulta = texto.slice('WEBSEARCH:'.length)
    const id = `toolu_ws_${turnos}`
    salida({ type: 'assistant', message: { model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id, name: 'WebSearch', input: { query: consulta, mode: 'standard' } }] } })
    await esperar(30)
    const enlaces = [{ title: 'Primera página', url: 'https://ejemplo.org/uno' }, { title: 'Segunda página', url: 'https://ejemplo.org/dos' }]
    salida({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `Web search results for query: "${consulta}"\n\nLinks: ${JSON.stringify(enlaces)}\n\nResumen…` }] }
    })
    delta('Según la búsqueda, ya lo sé.')
    salida({ type: 'assistant', message: { model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Según la búsqueda, ya lo sé.' }] } })
    resultado()
    return
  }

  // Caso normal: recuerda todo lo que le dicen y responde palabra a palabra.
  memoria.push(texto)
  const respuesta = `Turno ${turnos} (${memoria.length} mensajes en memoria${hayImagen ? ', con imagen' : ''}): ${texto.slice(0, 20)}`
  for (const palabra of respuesta.split(' ')) {
    delta(palabra + ' ')
    await esperar(2)
  }
  salida({ type: 'assistant', message: { model: 'claude-sonnet-5-5', content: [{ type: 'text', text: respuesta }] } })
  resultado({ result: respuesta })
}

const lector = createInterface({ input: process.stdin })
lector.on('line', (linea) => {
  if (!linea.trim()) return
  const ev = JSON.parse(linea)
  if (ev.type === 'control_request' && ev.request?.subtype === 'interrupt') {
    if (ignorarInterrupciones) return
    interrumpido = true
    salida({ type: 'control_response', response: { subtype: 'success', request_id: ev.request_id, response: { still_queued: [] } } })
    return
  }
  if (ev.type === 'user') void manejarMensaje(ev.message)
})
lector.on('close', () => process.exit(0))
