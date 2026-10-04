import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ErrorChat } from '../src/main/chat/errores'
import { PROMPT_SISTEMA } from '../src/main/chat/prompt-sistema'
import type { ManejadoresTurno } from '../src/main/chat/proveedor'
import { ProveedorApi, type OpcionesProveedorApi } from '../src/main/chat/proveedor-api'

/** Petición que recibió el servidor de mentira. */
interface Recibida {
  url: string
  cabeceras: IncomingMessage['headers']
  cuerpo: Record<string, any>
}

type Respuesta = (res: ServerResponse, recibida: Recibida) => void | Promise<void>

let servidor: Server
let puerto: number
let recibidas: Recibida[]
let respuestas: Respuesta[]
let proveedores: ProveedorApi[]

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Espera a que se cumpla algo, en vez de a que pase un tiempo fijo (la máquina puede ir más lenta de lo previsto). */
async function esperarHasta(condicion: () => boolean, maximoMs = 5000): Promise<void> {
  const limite = Date.now() + maximoMs
  while (!condicion() && Date.now() < limite) await esperar(10)
}

function escribirEvento(res: ServerResponse, nombre: string, datos: unknown): void {
  res.write(`event: ${nombre}\ndata: ${JSON.stringify(datos)}\n\n`)
}

/** Respuesta en streaming con el formato de eventos de la API de Anthropic. */
function flujoDeTexto(trozos: string[], parada = 'end_turn', detalles?: unknown): Respuesta {
  return async (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    escribirEvento(res, 'message_start', {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 1 }
      }
    })
    escribirEvento(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    for (const trozo of trozos) {
      escribirEvento(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: trozo } })
      await esperar(5)
    }
    escribirEvento(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
    escribirEvento(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: parada, stop_sequence: null, ...(detalles ? { stop_details: detalles } : {}) },
      usage: { output_tokens: 12 }
    })
    escribirEvento(res, 'message_stop', { type: 'message_stop' })
    res.end()
  }
}

function errorHttp(estado: number, tipo: string, mensaje: string, cabeceras: Record<string, string> = {}): Respuesta {
  return (res) => {
    res.writeHead(estado, { 'content-type': 'application/json', ...cabeceras })
    res.end(JSON.stringify({ type: 'error', error: { type: tipo, message: mensaje } }))
  }
}

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const trozos: Buffer[] = []
    req.on('data', (t) => trozos.push(t))
    req.on('end', () => {
      const recibida: Recibida = {
        url: req.url ?? '',
        cabeceras: req.headers,
        cuerpo: JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}')
      }
      recibidas.push(recibida)
      const siguiente = respuestas.shift()
      if (!siguiente) {
        res.writeHead(500).end('sin respuesta preparada')
        return
      }
      void siguiente(res, recibida)
    })
  })
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r))
  puerto = (servidor.address() as AddressInfo).port
})

afterAll(async () => {
  servidor.closeAllConnections()
  await new Promise((r) => servidor.close(r))
})

beforeEach(() => {
  recibidas = []
  respuestas = []
  proveedores = []
})
afterEach(() => {
  for (const p of proveedores) p.cerrar()
})

function crear(extra: Partial<OpcionesProveedorApi> = {}): ProveedorApi {
  const p = new ProveedorApi({
    apiKey: 'sk-ant-de-prueba',
    modelo: 'claude-sonnet-5-5',
    esfuerzo: 'medium',
    baseURL: `http://127.0.0.1:${puerto}`,
    maxRetries: 0,
    timeoutMs: 5000,
    ...extra
  })
  proveedores.push(p)
  return p
}

function recolector(): ManejadoresTurno & { textos: string[]; texto(): string } {
  const textos: string[] = []
  return { textos, texto: () => textos.join(''), alTexto: (d) => textos.push(d) }
}

async function errorDe(promesa: Promise<unknown>): Promise<ErrorChat> {
  try {
    await promesa
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorChat)
    return e as ErrorChat
  }
  throw new Error('Se esperaba un error y no hubo ninguno')
}

describe('ProveedorApi', () => {
  it('emite el texto en streaming y acaba con motivo «completo»', async () => {
    respuestas.push(flujoDeTexto(['¡Ho', 'la,', ' mundo!']))
    const m = recolector()
    const r = await crear().enviar({ texto: 'Saluda' }, m)
    expect(r.motivo).toBe('completo')
    expect(m.textos).toEqual(['¡Ho', 'la,', ' mundo!'])
  })

  it('manda el modelo, el esfuerzo, el prompt de sistema y el reintento de seguridad por defecto', async () => {
    respuestas.push(flujoDeTexto(['ok']))
    await crear({ modelo: 'claude-opus-5-5', esfuerzo: 'high' }).enviar({ texto: 'hola' }, recolector())
    const { cuerpo, cabeceras, url } = recibidas[0]
    expect(url).toContain('/v1/messages')
    expect(cuerpo['model']).toBe('claude-opus-5-5')
    expect(cuerpo['stream']).toBe(true)
    expect(cuerpo['output_config']).toEqual({ effort: 'high' })
    expect(String(cuerpo['system']).startsWith(PROMPT_SISTEMA)).toBe(true)
    expect(cuerpo['fallbacks']).toBe('default')
    expect(cabeceras['anthropic-beta']).toContain('server-side-fallback-2026-07-01')
    expect(cabeceras['x-api-key']).toBe('sk-ant-de-prueba')
    expect(cuerpo['thinking']).toBeUndefined() // en estos modelos se omite: nada de budget_tokens
    expect(cuerpo['temperature']).toBeUndefined()
  })

  it('el prompt lleva la fecha de hoy y la memoria del usuario', async () => {
    respuestas.push(flujoDeTexto(['ok']))
    const p = crear({ memoria: () => 'Memoria del usuario\n<memoria>\n- [Perfil] Le gusta la astronomía\n</memoria>', ahora: () => new Date(2026, 9, 4, 10) })
    await p.enviar({ texto: 'hola' }, recolector())
    const sistema = String(recibidas[0].cuerpo['system'])
    expect(sistema).toContain('Hoy es domingo 4 de octubre de 2026.')
    expect(sistema).toContain('- [Perfil] Le gusta la astronomía')
  })

  it('la memoria se fija al empezar la conversación y se renueva con «nueva conversación»', async () => {
    respuestas.push(flujoDeTexto(['uno']), flujoDeTexto(['dos']), flujoDeTexto(['tres']))
    let memoria = 'NOTAS V1'
    const p = crear({ memoria: () => memoria })
    await p.enviar({ texto: 'primero' }, recolector())
    memoria = 'NOTAS V2' // el usuario guarda algo a mitad de conversación
    await p.enviar({ texto: 'segundo' }, recolector())
    p.reiniciar()
    await p.enviar({ texto: 'tercero' }, recolector())

    const sistemas = recibidas.map((r) => String(r.cuerpo['system']))
    expect(sistemas[0]).toContain('NOTAS V1')
    expect(sistemas[1]).toContain('NOTAS V1') // misma conversación: el prompt no cambia (caché)
    expect(sistemas[1]).not.toContain('NOTAS V2')
    expect(sistemas[2]).toContain('NOTAS V2')
  })

  it('un primer intento fallido no fija la memoria de la conversación', async () => {
    respuestas.push(errorHttp(500, 'api_error', 'fallo'), flujoDeTexto(['ok']))
    let memoria = 'NOTAS V1'
    const p = crear({ memoria: () => memoria })
    await p.enviar({ texto: 'hola' }, recolector()).catch(() => undefined)
    memoria = 'NOTAS V2'
    await p.enviar({ texto: 'hola otra vez' }, recolector())
    expect(String(recibidas[1].cuerpo['system'])).toContain('NOTAS V2')
  })

  it('el mensaje lleva la conversación anterior y la nota de la aplicación antes de lo que escribió el usuario', async () => {
    respuestas.push(flujoDeTexto(['ok']))
    await crear().enviar(
      { texto: 'sigamos', historialPrevio: 'Usuario: hola\nOrbe: ¡hola!', notaApp: 'Orbe ha guardado una nota.' },
      recolector()
    )
    const mensajes = recibidas[0].cuerpo['messages'] as Array<{ content: Array<{ text: string }> }>
    const texto = mensajes[0].content[0].text
    expect(texto.indexOf('<conversacion_anterior>')).toBeLessThan(texto.indexOf('<nota_de_la_app>'))
    expect(texto.indexOf('<nota_de_la_app>')).toBeLessThan(texto.indexOf('sigamos'))
  })

  it('se puede desactivar el reintento de seguridad', async () => {
    respuestas.push(flujoDeTexto(['ok']))
    await crear({ fallbacks: false }).enviar({ texto: 'hola' }, recolector())
    expect(recibidas[0].cuerpo['fallbacks']).toBeUndefined()
    expect(String(recibidas[0].cabeceras['anthropic-beta'] ?? '')).not.toContain('server-side-fallback')
  })

  it('conserva el historial: el segundo turno reenvía la conversación entera', async () => {
    respuestas.push(flujoDeTexto(['Hola ', 'Ana']), flujoDeTexto(['Te llamas Ana']))
    const p = crear()
    await p.enviar({ texto: 'Me llamo Ana' }, recolector())
    await p.enviar({ texto: '¿Cómo me llamo?' }, recolector())

    const mensajes = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: unknown }>
    expect(mensajes.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(mensajes[1].content).toBe('Hola Ana')
    expect(JSON.stringify(mensajes[0].content)).toContain('Me llamo Ana')
  })

  it('un turno fallido no ensucia el historial', async () => {
    respuestas.push(errorHttp(529, 'overloaded_error', 'Overloaded'), flujoDeTexto(['bien']))
    const p = crear()
    await errorDe(p.enviar({ texto: 'primero' }, recolector()))
    await p.enviar({ texto: 'segundo' }, recolector())
    const mensajes = recibidas[1].cuerpo['messages'] as unknown[]
    expect(mensajes).toHaveLength(1) // solo el segundo mensaje del usuario
  })

  it('reiniciar vacía la conversación', async () => {
    respuestas.push(flujoDeTexto(['uno']), flujoDeTexto(['dos']))
    const p = crear()
    await p.enviar({ texto: 'a' }, recolector())
    p.reiniciar()
    await p.enviar({ texto: 'b' }, recolector())
    expect(recibidas[1].cuerpo['messages']).toHaveLength(1)
  })

  it('envía las capturas de pantalla como imagen base64 antes del texto', async () => {
    respuestas.push(flujoDeTexto(['veo una ventana']))
    await crear().enviar(
      { texto: '¿Qué ves?', contexto: { imagen: { tipoMime: 'image/jpeg', base64: 'QUJD', ancho: 100, alto: 50 } } },
      recolector()
    )
    const contenido = recibidas[0].cuerpo['messages'][0].content as Array<{ type: string; source?: Record<string, string>; text?: string }>
    expect(contenido[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } })
    expect(contenido[1].type).toBe('text')
    expect(contenido[1].text).toContain('<captura>')
  })

  it('401 → clave no válida', async () => {
    respuestas.push(errorHttp(401, 'authentication_error', 'invalid x-api-key'))
    const e = await errorDe(crear().enviar({ texto: 'x' }, recolector()))
    expect(e.error.codigo).toBe('clave_invalida')
  })

  it('429 → límite de uso con la espera indicada', async () => {
    respuestas.push(errorHttp(429, 'rate_limit_error', 'Rate limited', { 'retry-after': '42' }))
    const e = await errorDe(crear().enviar({ texto: 'x' }, recolector()))
    expect(e.error.codigo).toBe('limite_uso')
    expect(e.error.mensaje).toContain('42 segundos')
  })

  it('529 → saturación', async () => {
    respuestas.push(errorHttp(529, 'overloaded_error', 'Overloaded'))
    const e = await errorDe(crear().enviar({ texto: 'x' }, recolector()))
    expect(e.error.codigo).toBe('sobrecarga')
  })

  it('400 → petición no válida, con el motivo que da la API', async () => {
    respuestas.push(errorHttp(400, 'invalid_request_error', 'messages: texto no válido'))
    const e = await errorDe(crear().enviar({ texto: 'x' }, recolector()))
    expect(e.error.codigo).toBe('solicitud_invalida')
    expect(e.error.mensaje).toContain('texto no válido')
  })

  it('404 → modelo no disponible', async () => {
    respuestas.push(errorHttp(404, 'not_found_error', 'model: claude-inventado'))
    const e = await errorDe(crear({ modelo: 'claude-inventado' }).enviar({ texto: 'x' }, recolector()))
    expect(e.error.codigo).toBe('modelo')
  })

  it('sin servidor al que conectar → sin conexión', async () => {
    const e = await errorDe(crear({ baseURL: 'http://127.0.0.1:1' }).enviar({ texto: 'x' }, recolector()))
    expect(e.error.codigo).toBe('sin_conexion')
    expect(e.error.reintentable).toBe(true)
  })

  it('un rechazo de seguridad (stop_reason refusal) es un error «rechazo» con su categoría', async () => {
    respuestas.push(flujoDeTexto([], 'refusal', { type: 'refusal', category: 'cyber', explanation: null }))
    const e = await errorDe(crear().enviar({ texto: 'x' }, recolector()))
    expect(e.error.codigo).toBe('rechazo')
    expect(e.error.detalle).toContain('cyber')
  })

  it('una respuesta cortada por longitud acaba con motivo «limite_tokens»', async () => {
    respuestas.push(flujoDeTexto(['texto largo…'], 'max_tokens'))
    const r = await crear().enviar({ texto: 'x' }, recolector())
    expect(r.motivo).toBe('limite_tokens')
  })

  it('cancelar a mitad de respuesta deja el texto parcial en la conversación', async () => {
    const lenta: Respuesta = async (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      escribirEvento(res, 'message_start', {
        type: 'message_start',
        message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
      })
      escribirEvento(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      for (let i = 0; i < 200; i++) {
        if (res.destroyed || res.writableEnded) return
        escribirEvento(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `p${i} ` } })
        await esperar(20)
      }
      res.end()
    }
    respuestas.push(lenta, flujoDeTexto(['ok']))
    const p = crear()
    const m = recolector()
    const envio = p.enviar({ texto: 'cuenta' }, m)
    await esperarHasta(() => m.textos.length > 0)
    p.cancelar()
    const r = await envio
    expect(r.motivo).toBe('cancelado')
    expect(m.textos.length).toBeGreaterThan(0)

    await p.enviar({ texto: 'sigue' }, recolector())
    const mensajes = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: unknown }>
    expect(mensajes.map((x) => x.role)).toEqual(['user', 'assistant', 'user'])
    expect(String(mensajes[1].content)).toContain('p0')
  })

  it('sin API key, avisa de qué falta sin llegar a conectar', async () => {
    const e = await errorDe(crear({ apiKey: '' }).enviar({ texto: 'x' }, recolector()))
    expect(e.error.codigo).toBe('clave_invalida')
    expect(e.error.mensaje).toContain('ANTHROPIC_API_KEY')
    expect(recibidas).toHaveLength(0)
  })

  it('rechaza un segundo envío mientras hay una respuesta en curso', async () => {
    respuestas.push(flujoDeTexto(['uno', 'dos', 'tres', 'cuatro']))
    const p = crear()
    const primero = p.enviar({ texto: 'a' }, recolector())
    const e = await errorDe(p.enviar({ texto: 'b' }, recolector()))
    expect(e.error.codigo).toBe('solicitud_invalida')
    await primero
  })
})
