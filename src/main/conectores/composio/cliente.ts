/**
 * Cliente MCP mínimo para Composio Connect (https://docs.composio.dev/docs/composio-connect.md): transporte HTTP
 * «streamable» en `https://connect.composio.dev/mcp`, con la clave en la cabecera `x-consumer-api-key` (nunca en la URL,
 * para que no salga en registros). Solo con `fetch`: initialize → notifications/initialized → tools/call.
 */
export const URL_COMPOSIO = 'https://connect.composio.dev/mcp'
const VERSION_PROTOCOLO = '2025-06-18'

type Fetch = typeof fetch

interface RespuestaRpc {
  id?: number
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean }
  error?: { code: number; message: string }
}

/** La respuesta puede llegar como JSON o como un flujo SSE con líneas «data: {...}»: se busca la de nuestro id. */
export function leerRespuesta(cuerpo: string, tipo: string, id: number): RespuestaRpc | undefined {
  const mensajes: unknown[] = []
  if (tipo.includes('text/event-stream')) {
    for (const linea of cuerpo.split(/\r?\n/)) {
      if (!linea.startsWith('data:')) continue
      try {
        mensajes.push(JSON.parse(linea.slice(5).trim()))
      } catch {
        // línea que no es JSON: se ignora
      }
    }
  } else if (cuerpo.trim()) {
    const v = JSON.parse(cuerpo) as unknown
    mensajes.push(...(Array.isArray(v) ? v : [v]))
  }
  return mensajes.find((m): m is RespuestaRpc => typeof m === 'object' && m !== null && (m as RespuestaRpc).id === id)
}

/** Error con un mensaje para el usuario. Nunca lleva la clave. */
export class ErrorComposio extends Error {}

export class ClienteComposio {
  private sesion: string | undefined
  private iniciado = false
  private siguienteId = 1

  constructor(
    private readonly clave: () => string | undefined,
    private readonly hacerFetch: Fetch = fetch,
    private readonly url = URL_COMPOSIO
  ) {}

  private async enviar(metodo: string, params: unknown, senal?: AbortSignal, notificacion = false): Promise<RespuestaRpc | undefined> {
    const clave = this.clave()
    if (!clave) throw new ErrorComposio('Composio no está conectado: guarda tu clave en Configuración → Conectores → Composio.')
    const id = this.siguienteId++
    const cabeceras: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-consumer-api-key': clave,
      'mcp-protocol-version': VERSION_PROTOCOLO
    }
    if (this.sesion) cabeceras['mcp-session-id'] = this.sesion
    const r = await this.hacerFetch(this.url, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify(notificacion ? { jsonrpc: '2.0', method: metodo, params } : { jsonrpc: '2.0', id, method: metodo, params }),
      signal: senal
    })
    const sesion = r.headers.get('mcp-session-id')
    if (sesion) this.sesion = sesion
    if (r.status === 401 || r.status === 403) throw new ErrorComposio('Composio rechazó la clave: revisa la que guardaste en Conectores.')
    if (r.status === 404 && metodo !== 'initialize') {
      // La sesión caducó: la siguiente llamada empieza otra.
      this.sesion = undefined
      this.iniciado = false
      throw new ErrorComposio('La sesión con Composio caducó; vuelve a intentarlo.')
    }
    if (!r.ok) throw new ErrorComposio(`Composio respondió ${r.status}.`)
    if (notificacion) return undefined
    const respuesta = leerRespuesta(await r.text(), r.headers.get('content-type') ?? '', id)
    if (!respuesta) throw new ErrorComposio('Composio no devolvió respuesta.')
    if (respuesta.error) throw new ErrorComposio(`Composio: ${respuesta.error.message}`)
    return respuesta
  }

  private async iniciar(senal?: AbortSignal): Promise<void> {
    if (this.iniciado) return
    await this.enviar('initialize', { protocolVersion: VERSION_PROTOCOLO, capabilities: {}, clientInfo: { name: 'orbe', version: '1' } }, senal)
    await this.enviar('notifications/initialized', {}, senal, true)
    this.iniciado = true
  }

  /** Llama a una meta-herramienta de Composio y devuelve su resultado como JSON (o el texto tal cual si no lo es). */
  async llamar(nombre: string, argumentos: Record<string, unknown>, senal?: AbortSignal): Promise<unknown> {
    await this.iniciar(senal)
    const r = await this.enviar('tools/call', { name: nombre, arguments: argumentos }, senal)
    const texto = (r?.result?.content ?? []).map((c) => c.text ?? '').join('')
    if (r?.result?.isError) throw new ErrorComposio(`Composio: ${texto.slice(0, 300) || 'error sin detalle'}`)
    try {
      return JSON.parse(texto) as unknown
    } catch {
      return texto
    }
  }
}
