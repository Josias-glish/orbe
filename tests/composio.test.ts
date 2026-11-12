import { describe, expect, it } from 'vitest'
import { clasificarAccion } from '../src/main/conectores/composio/clasificar'
import { ClienteComposio, leerRespuesta, URL_COMPOSIO } from '../src/main/conectores/composio/cliente'
import { crearHerramientasComposio, validarEjecutar } from '../src/main/agente/herramientas/composio'
import { Politica } from '../src/main/agente/politica'
import { modoDe } from '../src/main/agente/reglas'

const CLAVE = 'clave-secreta-de-prueba-123'

/** Un Composio de mentira: responde initialize, la notificación y tools/call con lo que diga `herramientas`. */
function composioFalso(herramientas: Record<string, unknown>, estado = 200) {
  const peticiones: Array<{ url: string; cabeceras: Record<string, string>; cuerpo: { method: string; params?: { name?: string; arguments?: unknown } } }> = []
  const hacerFetch = (async (url: string, init: RequestInit) => {
    const cuerpo = JSON.parse(String(init.body)) as { id?: number; method: string; params?: { name?: string; arguments?: unknown } }
    peticiones.push({ url, cabeceras: init.headers as Record<string, string>, cuerpo })
    if (estado !== 200) return new Response('no', { status: estado })
    if (cuerpo.id === undefined) return new Response(null, { status: 202 })
    const resultado =
      cuerpo.method === 'initialize'
        ? { protocolVersion: '2025-06-18', capabilities: {} }
        : { content: [{ type: 'text', text: JSON.stringify(herramientas[cuerpo.params?.name ?? ''] ?? {}) }] }
    // initialize en JSON, el resto como SSE: el cliente tiene que entender los dos.
    if (cuerpo.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: cuerpo.id, result: resultado }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'ses-1' } })
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: cuerpo.id, result: resultado })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch
  return { peticiones, hacerFetch }
}

const ctx = { senal: new AbortController().signal } as never

describe('clasificar acciones de Composio', () => {
  it('leer va libre; todo lo demás, incluido enviar o borrar, pide permiso', () => {
    expect(clasificarAccion('GOOGLECALENDAR_LIST_EVENTS')).toBe('composio.leer')
    expect(clasificarAccion('NOTION_SEARCH_NOTION_PAGE')).toBe('composio.leer')
    expect(clasificarAccion('GMAIL_LIST_THREADS')).toBe('composio.leer')
    expect(clasificarAccion('GOOGLECALENDAR_CREATE_EVENT')).toBe('composio.escribir')
    expect(clasificarAccion('SLACK_SEND_MESSAGE')).toBe('composio.escribir')
    expect(clasificarAccion('TRELLO_DELETE_CARD')).toBe('composio.escribir')
  })

  it('escribir nunca baja de «preguntar» y un reglas.json antiguo usa los valores por defecto', () => {
    expect(modoDe('composio.leer', {})).toBe('libre')
    expect(modoDe('composio.escribir', {})).toBe('preguntar')
    expect(modoDe('composio.escribir', { 'composio.escribir': 'libre' })).toBe('preguntar')
  })
})

describe('cliente MCP de Composio', () => {
  it('lee respuestas SSE y JSON', () => {
    expect(leerRespuesta('event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{}}\n\n', 'text/event-stream', 3)?.result).toEqual({})
    expect(leerRespuesta('{"jsonrpc":"2.0","id":1,"result":{"a":1}}', 'application/json', 1)?.result).toEqual({ a: 1 })
  })

  it('la clave va en la cabecera, nunca en la URL; la sesión se reutiliza', async () => {
    const f = composioFalso({ COMPOSIO_SEARCH_TOOLS: { data: {} } })
    const c = new ClienteComposio(() => CLAVE, f.hacerFetch)
    await c.llamar('COMPOSIO_SEARCH_TOOLS', {})
    expect(f.peticiones.map((p) => p.cuerpo.method)).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
    for (const p of f.peticiones) {
      expect(p.url).toBe(URL_COMPOSIO)
      expect(p.cabeceras['x-consumer-api-key']).toBe(CLAVE)
    }
    expect(f.peticiones[2]!.cabeceras['mcp-session-id']).toBe('ses-1')
  })

  it('sin clave o con la clave rechazada da un aviso que no contiene la clave', async () => {
    await expect(new ClienteComposio(() => undefined, composioFalso({}).hacerFetch).llamar('X', {})).rejects.toThrow(/guarda tu clave/)
    const error = await new ClienteComposio(() => CLAVE, composioFalso({}, 401).hacerFetch).llamar('X', {}).catch((e: Error) => e.message)
    expect(error).toMatch(/rechazó la clave/)
    expect(error).not.toContain(CLAVE)
  })
})

describe('herramientas de Composio', () => {
  const busqueda = {
    data: {
      results: [{ primary_tool_slugs: ['GOOGLECALENDAR_LIST_EVENTS', 'GMAIL_SEND_EMAIL'], related_tool_slugs: ['GOOGLECALENDAR_CREATE_EVENT'] }],
      tool_schemas: { GOOGLECALENDAR_LIST_EVENTS: { params: 'x' }, GMAIL_SEND_EMAIL: { params: 'secreto' } },
      toolkit_connection_statuses: [{ toolkit: 'googlecalendar', has_active_connection: false }, { toolkit: 'gmail', has_active_connection: true }],
      session: { id: 'sess_9' }
    }
  }

  it('buscar marca el permiso de cada acción y el estado de cada conexión', async () => {
    const f = composioFalso({ COMPOSIO_SEARCH_TOOLS: busqueda })
    const [buscar] = crearHerramientasComposio(new ClienteComposio(() => CLAVE, f.hacerFetch))
    const r = await buscar!.ejecutar({ tarea: 'list events' }, ctx)
    expect(r.externo?.origen).toBe('Composio')
    expect(r.texto).toContain('GOOGLECALENDAR_LIST_EVENTS · leer (libre)')
    expect(r.texto).toContain('GOOGLECALENDAR_CREATE_EVENT · pide permiso')
    expect(r.texto).toContain('GMAIL_SEND_EMAIL · pide permiso')
    expect(r.texto).toContain('googlecalendar: sin conectar')
    expect(r.texto).toContain('gmail: conectada')
  })

  it('ejecutar: la política decide por la acción concreta', () => {
    const ejecutar = crearHerramientasComposio(new ClienteComposio(() => CLAVE, composioFalso({}).hacerFetch))[2]!
    const p = new Politica()
    const decidir = (accion: string): string => p.decidir(ejecutar, { accion, argumentos: '{}' }, 't').tipo
    expect(decidir('GOOGLECALENDAR_LIST_EVENTS')).toBe('permitir')
    expect(decidir('GOOGLECALENDAR_CREATE_EVENT')).toBe('confirmar')
    expect(decidir('SLACK_SEND_MESSAGE')).toBe('confirmar')
  })

  it('ejecutar valida el slug y que los argumentos sean un objeto JSON, y manda una sola acción', async () => {
    expect(validarEjecutar({ accion: 'listar cosas', argumentos: '{}' }).ok).toBe(false)
    expect(validarEjecutar({ accion: 'NOTION_SEARCH_NOTION_PAGE', argumentos: '[1]' }).ok).toBe(false)
    expect(validarEjecutar({ accion: 'NOTION_SEARCH_NOTION_PAGE', argumentos: 'no' }).ok).toBe(false)
    const v = validarEjecutar({ accion: 'notion_search_notion_page', argumentos: '{"query":"plan"}' })
    expect(v).toEqual({ ok: true, valor: { accion: 'NOTION_SEARCH_NOTION_PAGE', argumentos: '{"query":"plan"}' } })
    const f = composioFalso({ COMPOSIO_MULTI_EXECUTE_TOOL: { successful: true, data: { results: [{ response: { paginas: ['Plan'] } }] } } })
    const ejecutar = crearHerramientasComposio(new ClienteComposio(() => CLAVE, f.hacerFetch))[2]!
    const r = await ejecutar.ejecutar(v.ok ? v.valor : null, ctx)
    expect(r.texto).toContain('Plan')
    const llamada = f.peticiones.at(-1)!.cuerpo.params!.arguments as { tools: unknown[] }
    expect(llamada.tools).toEqual([{ tool_slug: 'NOTION_SEARCH_NOTION_PAGE', arguments: { query: 'plan' } }])
  })

  it('conectar devuelve el enlace de OAuth', async () => {
    const f = composioFalso({ COMPOSIO_MANAGE_CONNECTIONS: { data: { results: { notion: { redirect_url: 'https://backend.composio.dev/oauth/abc' } } } } })
    const conectar = crearHerramientasComposio(new ClienteComposio(() => CLAVE, f.hacerFetch))[1]!
    expect((await conectar.ejecutar({ app: 'notion' }, ctx)).texto).toContain('https://backend.composio.dev/oauth/abc')
  })
})
