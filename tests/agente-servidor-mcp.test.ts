import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ServidorMcp, type ManejadorMcp, type RespuestaHerramienta } from '../src/main/agente/servidor-mcp'

const HERRAMIENTAS = [
  { name: 'eco', description: 'Repite.', inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }
]

let servidor: ServidorMcp
let url: string
let llamadas: Array<{ nombre: string; argumentos: unknown }>
let respuesta: (nombre: string, argumentos: unknown, senal: AbortSignal) => Promise<RespuestaHerramienta>

beforeEach(async () => {
  llamadas = []
  respuesta = async (nombre, argumentos) => ({ texto: `hecho ${nombre}`, esError: false })
  const manejador: ManejadorMcp = {
    listar: () => HERRAMIENTAS,
    llamar: (nombre, argumentos, senal) => {
      llamadas.push({ nombre, argumentos })
      return respuesta(nombre, argumentos, senal)
    }
  }
  servidor = new ServidorMcp(manejador, { nombre: 'orbe-prueba', version: '9.9.9' })
  url = await servidor.iniciar()
})
afterEach(async () => {
  await servidor.cerrar()
})

const cabeceras = (extra: Record<string, string> = {}): Record<string, string> => ({
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  authorization: `Bearer ${servidor.token}`,
  ...extra
})

async function rpc(cuerpo: Record<string, unknown>, extra: Record<string, string> = {}): Promise<{ estado: number; json: any }> {
  const r = await fetch(url, { method: 'POST', headers: cabeceras(extra), body: JSON.stringify({ jsonrpc: '2.0', ...cuerpo }) })
  const texto = await r.text()
  return { estado: r.status, json: texto ? JSON.parse(texto) : null }
}

describe('ServidorMcp: arranque', () => {
  it('escucha solo en 127.0.0.1, en un puerto libre, y se puede iniciar varias veces', async () => {
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(await servidor.iniciar()).toBe(url)
    expect(servidor.token).toMatch(/^[0-9a-f]{64}$/)
    expect(new ServidorMcp({ listar: () => [], llamar: async () => ({ texto: '', esError: false }) }).token).not.toBe(servidor.token)
  })

  it('después de cerrar ya no contesta', async () => {
    await servidor.cerrar()
    expect(servidor.url).toBeNull()
    await expect(fetch(url, { method: 'POST', headers: cabeceras(), body: '{}' })).rejects.toThrow()
  })
})

describe('ServidorMcp: protocolo', () => {
  it('initialize devuelve la versión pedida si la conoce y declara solo herramientas', async () => {
    const { estado, json } = await rpc({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } })
    expect(estado).toBe(200)
    expect(json).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'orbe-prueba', version: '9.9.9' } }
    })
  })

  it('con una versión que no conoce, ofrece la suya más nueva', async () => {
    const { json } = await rpc({ id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } })
    expect(json.result.protocolVersion).toBe('2025-11-25')
    const sin = await rpc({ id: 2, method: 'initialize' })
    expect(sin.json.result.protocolVersion).toBe('2025-11-25')
  })

  it('una notificación se acepta sin cuerpo', async () => {
    const { estado, json } = await rpc({ method: 'notifications/initialized' })
    expect(estado).toBe(202)
    expect(json).toBeNull()
  })

  it('tools/list devuelve las herramientas del manejador', async () => {
    const { json } = await rpc({ id: 7, method: 'tools/list' })
    expect(json).toEqual({ jsonrpc: '2.0', id: 7, result: { tools: HERRAMIENTAS } })
  })

  it('tools/call llama a la herramienta y devuelve su resultado como texto', async () => {
    respuesta = async () => ({ texto: 'abierta', esError: false })
    const { json } = await rpc({ id: 3, method: 'tools/call', params: { name: 'eco', arguments: { texto: 'hola' } } })
    expect(json).toEqual({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'abierta' }], isError: false } })
    expect(llamadas).toEqual([{ nombre: 'eco', argumentos: { texto: 'hola' } }])
  })

  it('un error de la herramienta llega marcado como error, y una excepción también', async () => {
    respuesta = async () => ({ texto: 'PROHIBIDO: no.', esError: true })
    expect((await rpc({ id: 1, method: 'tools/call', params: { name: 'eco', arguments: {} } })).json.result).toEqual({
      content: [{ type: 'text', text: 'PROHIBIDO: no.' }],
      isError: true
    })
    respuesta = async () => {
      throw new Error('se rompió')
    }
    expect((await rpc({ id: 2, method: 'tools/call', params: { name: 'eco', arguments: {} } })).json.result).toEqual({
      content: [{ type: 'text', text: 'Error: se rompió' }],
      isError: true
    })
  })

  it('una herramienta que no existe o sin nombre es un error de protocolo y no llega al manejador', async () => {
    const ajena = await rpc({ id: 1, method: 'tools/call', params: { name: 'borrar_todo', arguments: {} } })
    expect(ajena.json.error.code).toBe(-32602)
    const sinNombre = await rpc({ id: 2, method: 'tools/call', params: { arguments: {} } })
    expect(sinNombre.json.error.code).toBe(-32602)
    expect(llamadas).toEqual([])
  })

  it('los métodos que no conoce (como server/discover) dan «no existe», que es lo que el CLI espera para seguir con initialize', async () => {
    const r = await rpc({ id: 'server-discover-probe-1', method: 'server/discover', params: {} })
    expect(r.estado).toBe(200)
    expect(r.json).toEqual({ jsonrpc: '2.0', id: 'server-discover-probe-1', error: { code: -32601, message: 'No conozco el método «server/discover».' } })
    expect((await rpc({ id: 1, method: 'ping' })).json.result).toEqual({})
  })

  it('un cuerpo que no es JSON o no es una petición se rechaza', async () => {
    const mal = await fetch(url, { method: 'POST', headers: cabeceras(), body: '{no es json' })
    expect(mal.status).toBe(400)
    const lista = await fetch(url, { method: 'POST', headers: cabeceras(), body: '[{"jsonrpc":"2.0","id":1,"method":"ping"}]' })
    expect(lista.status).toBe(400)
    const sinMetodo = await fetch(url, { method: 'POST', headers: cabeceras(), body: '{"jsonrpc":"2.0","id":1}' })
    expect(sinMetodo.status).toBe(400)
  })

  it('un cuerpo enorme se corta', async () => {
    const r = await fetch(url, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { x: 'a'.repeat(1_200_000) } }) }).catch(() => null)
    expect(r === null || r.status === 413).toBe(true)
  })

  it('el canal de eventos (GET) no se ofrece, y otras rutas no existen', async () => {
    const get = await fetch(url, { headers: cabeceras({ accept: 'text/event-stream' }) })
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
    const otra = await fetch(url.replace('/mcp', '/otra'), { method: 'POST', headers: cabeceras(), body: '{}' })
    expect(otra.status).toBe(404)
  })

  it('si el cliente cuelga a mitad de una llamada, la herramienta se entera', async () => {
    let senalRecibida: AbortSignal | null = null
    respuesta = (_n, _a, senal) => {
      senalRecibida = senal
      return new Promise(() => {})
    }
    const control = new AbortController()
    const peticion = fetch(url, { method: 'POST', headers: cabeceras(), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'eco', arguments: {} } }), signal: control.signal }).catch(() => null)
    const limite = Date.now() + 3000
    while (!senalRecibida && Date.now() < limite) await new Promise((r) => setTimeout(r, 10))
    expect(senalRecibida).not.toBeNull()
    expect((senalRecibida as unknown as AbortSignal).aborted).toBe(false)
    control.abort()
    await peticion
    const fin = Date.now() + 3000
    while (!(senalRecibida as unknown as AbortSignal).aborted && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    expect((senalRecibida as unknown as AbortSignal).aborted).toBe(true)
  })
})

describe('ServidorMcp: quién puede hablarle', () => {
  const cuerpo = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })

  it('sin el secreto, o con otro, responde 401 y no llega nada al manejador', async () => {
    const sin = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: cuerpo })
    expect(sin.status).toBe(401)
    for (const autorizacion of ['Bearer otro', `Bearer ${servidor.token}x`, servidor.token, `bearer ${servidor.token}`, 'Basic abc']) {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: autorizacion }, body: cuerpo })
      expect(r.status, autorizacion).toBe(401)
    }
    expect(llamadas).toEqual([])
  })

  it('una petición con «Origin» (de una página web) se rechaza aunque lleve el secreto', async () => {
    const r = await fetch(url, { method: 'POST', headers: cabeceras({ origin: 'http://malo.example' }), body: cuerpo })
    expect(r.status).toBe(401)
  })

  it('un nombre de host que no es este equipo (DNS rebinding) se rechaza', async () => {
    const puerto = new URL(url).port
    // `fetch` no deja cambiar «Host», así que se habla en crudo.
    const { connect } = await import('node:net')
    const estado = await new Promise<string>((resolver) => {
      const socket = connect(Number(puerto), '127.0.0.1', () => {
        socket.write(`POST /mcp HTTP/1.1\r\nHost: atacante.example:${puerto}\r\nAuthorization: Bearer ${servidor.token}\r\nContent-Type: application/json\r\nContent-Length: ${cuerpo.length}\r\nConnection: close\r\n\r\n${cuerpo}`)
      })
      let datos = ''
      socket.on('data', (t) => (datos += t.toString()))
      socket.on('close', () => resolver(datos.split('\r\n')[0]))
    })
    expect(estado).toContain('401')
    expect(llamadas).toEqual([])
  })
})
