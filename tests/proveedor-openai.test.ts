import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resolverConfig } from '../src/main/entorno'
import { ErrorChat } from '../src/main/chat/errores'
import { PROMPT_SISTEMA } from '../src/main/chat/prompt-sistema'
import type { ManejadoresTurno } from '../src/main/chat/proveedor'
import { ProveedorOpenai, contenidoParaApi, errorDesdeHttp, normalizarUrlBase, type OpcionesProveedorOpenai } from '../src/main/chat/proveedor-openai'

interface Recibida {
  url: string
  metodo: string
  cabeceras: IncomingMessage['headers']
  cuerpo: Record<string, any>
}
type Respuesta = (res: ServerResponse, recibida: Recibida) => void | Promise<void>

let servidor: Server
let puerto: number
let recibidas: Recibida[]
let respuestas: Respuesta[]
let proveedores: ProveedorOpenai[]

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function esperarHasta(condicion: () => boolean, maximoMs = 5000): Promise<void> {
  const limite = Date.now() + maximoMs
  while (!condicion() && Date.now() < limite) await esperar(10)
}

const trozo = (texto: string, fin: string | null = null): string =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: texto ? { content: texto } : {}, finish_reason: fin }] })}\n\n`

/** Respuesta en streaming con el formato de «chat completions». */
function flujo(trozos: string[], fin: string = 'stop'): Respuesta {
  return async (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' } }] })}\n\n`)
    for (const t of trozos) {
      res.write(trozo(t))
      await esperar(3)
    }
    res.write(trozo('', fin))
    res.write(`data: ${JSON.stringify({ choices: [], usage: { total_tokens: 12 } })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  }
}

const errorHttp = (estado: number, cuerpo: unknown): Respuesta => (res) => {
  res.writeHead(estado, { 'content-type': 'application/json' })
  res.end(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo))
}

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const partes: Buffer[] = []
    req.on('data', (t) => partes.push(t))
    req.on('end', () => {
      const recibida: Recibida = {
        url: req.url ?? '',
        metodo: req.method ?? '',
        cabeceras: req.headers,
        cuerpo: JSON.parse(Buffer.concat(partes).toString('utf8') || '{}')
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

function crear(extra: Partial<OpcionesProveedorOpenai> = {}): ProveedorOpenai {
  const p = new ProveedorOpenai({ url: `http://127.0.0.1:${puerto}/v1`, clave: 'clave-de-prueba', modelo: 'modelo-x', ...extra })
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

describe('ProveedorOpenai: la petición', () => {
  it('emite el texto en streaming y termina como «completo»', async () => {
    respuestas.push(flujo(['¡Ho', 'la,', ' mundo!']))
    const m = recolector()
    const r = await crear().enviar({ texto: 'Saluda' }, m)
    expect(r.motivo).toBe('completo')
    expect(m.textos).toEqual(['¡Ho', 'la,', ' mundo!'])
  })

  it('llama a /chat/completions con el modelo, el flujo activado, la clave y el prompt de Orbe', async () => {
    respuestas.push(flujo(['ok']))
    await crear({ ahora: () => new Date(2026, 9, 4, 10), memoria: () => 'Memoria del usuario\n- [Perfil] Estudiante' }).enviar({ texto: 'hola' }, recolector())
    const { url, metodo, cabeceras, cuerpo } = recibidas[0]
    expect(metodo).toBe('POST')
    expect(url).toBe('/v1/chat/completions')
    expect(cabeceras['authorization']).toBe('Bearer clave-de-prueba')
    expect(cuerpo['model']).toBe('modelo-x')
    expect(cuerpo['stream']).toBe(true)
    const [sistema, usuario] = cuerpo['messages'] as Array<{ role: string; content: string }>
    expect(sistema.role).toBe('system')
    expect(sistema.content.startsWith(PROMPT_SISTEMA)).toBe(true)
    expect(sistema.content).toContain('Hoy es domingo 4 de octubre de 2026.')
    expect(sistema.content).toContain('- [Perfil] Estudiante')
    expect(usuario).toEqual({ role: 'user', content: 'hola' })
  })

  it('sin clave (servidor local) no manda cabecera de autorización', async () => {
    respuestas.push(flujo(['ok']))
    await crear({ clave: '' }).enviar({ texto: 'hola' }, recolector())
    expect(recibidas[0].cabeceras['authorization']).toBeUndefined()
  })

  it('acepta la dirección con barra final o con la ruta completa pegada', async () => {
    respuestas.push(flujo(['a']), flujo(['b']))
    await crear({ url: `http://127.0.0.1:${puerto}/v1/` }).enviar({ texto: 'x' }, recolector())
    await crear({ url: `http://127.0.0.1:${puerto}/v1/chat/completions` }).enviar({ texto: 'x' }, recolector())
    expect(recibidas.map((r) => r.url)).toEqual(['/v1/chat/completions', '/v1/chat/completions'])
    expect(normalizarUrlBase(' https://api.groq.com/openai/v1/ ')).toBe('https://api.groq.com/openai/v1')
  })

  it('conserva el historial: el segundo turno reenvía la conversación', async () => {
    respuestas.push(flujo(['Hola ', 'Ana']), flujo(['Te llamas Ana']))
    const p = crear()
    await p.enviar({ texto: 'Me llamo Ana' }, recolector())
    await p.enviar({ texto: '¿Cómo me llamo?' }, recolector())
    const mensajes = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: string }>
    expect(mensajes.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(mensajes[1].content).toBe('Me llamo Ana')
    expect(mensajes[2].content).toBe('Hola Ana')
  })

  it('la memoria se fija al empezar la conversación y se renueva con «nueva conversación»', async () => {
    respuestas.push(flujo(['1']), flujo(['2']), flujo(['3']))
    let memoria = 'NOTAS V1'
    const p = crear({ memoria: () => memoria })
    await p.enviar({ texto: 'a' }, recolector())
    memoria = 'NOTAS V2'
    await p.enviar({ texto: 'b' }, recolector())
    p.reiniciar()
    await p.enviar({ texto: 'c' }, recolector())
    const sistemas = recibidas.map((r) => (r.cuerpo['messages'] as Array<{ content: string }>)[0].content)
    expect(sistemas[0]).toContain('NOTAS V1')
    expect(sistemas[1]).toContain('NOTAS V1')
    expect(sistemas[2]).toContain('NOTAS V2')
    expect((recibidas[2].cuerpo['messages'] as unknown[]).length).toBe(2) // solo el sistema y el mensaje: se olvidó lo anterior
  })

  it('una captura va como imagen en el mensaje, pero no se reenvía en los turnos siguientes', async () => {
    respuestas.push(flujo(['Veo un degradado']), flujo(['Ok']))
    const p = crear()
    await p.enviar({ texto: '¿Qué ves?', contexto: { imagen: { tipoMime: 'image/jpeg', base64: 'AAAA', ancho: 10, alto: 10 } } }, recolector())
    await p.enviar({ texto: 'Gracias' }, recolector())

    const primero = (recibidas[0].cuerpo['messages'] as Array<{ content: unknown }>)[1].content as Array<{ type: string; image_url?: { url: string }; text?: string }>
    expect(primero[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } })
    expect(primero[1].type).toBe('text')
    expect(primero[1].text).toContain('¿Qué ves?')

    const segundo = JSON.stringify(recibidas[1].cuerpo)
    expect(segundo).not.toContain('AAAA')
    expect(segundo).toContain('Veo un degradado')
  })

  it('sin imagen el contenido es un texto simple (lo entienden hasta los servidores locales más básicos)', () => {
    expect(contenidoParaApi({ texto: 'hola' }).completo).toBe('hola')
  })

  it('el contexto de pantalla y las notas de la aplicación viajan en el texto del mensaje', async () => {
    respuestas.push(flujo(['ok']))
    await crear().enviar(
      { texto: 'resume', contexto: { seleccion: 'texto elegido' }, notaApp: 'Orbe ha guardado una nota.', historialPrevio: 'Usuario: hola' },
      recolector()
    )
    const contenido = (recibidas[0].cuerpo['messages'] as Array<{ content: string }>)[1].content
    expect(contenido).toContain('<contexto_pantalla>')
    expect(contenido).toContain('<nota_de_la_app>')
    expect(contenido).toContain('<conversacion_anterior>')
    expect(contenido.endsWith('resume')).toBe(true)
  })
})

describe('ProveedorOpenai: el flujo', () => {
  it('un corte por longitud se distingue de un final normal', async () => {
    respuestas.push(flujo(['texto largo…'], 'length'))
    expect((await crear().enviar({ texto: 'x' }, recolector())).motivo).toBe('limite_tokens')
  })

  it('ignora trozos sin texto, de uso o que no son JSON', async () => {
    respuestas.push(async (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': comentario de keep-alive\n\n')
      res.write('data: esto no es json\n\n')
      res.write(trozo('Hola'))
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'pensando…' } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: null } }] })}\n\n`)
      res.write(trozo(' mundo'))
      res.write('data: [DONE]\n\n')
      res.end()
    })
    const m = recolector()
    await crear().enviar({ texto: 'x' }, m)
    expect(m.texto()).toBe('Hola mundo')
  })

  it('reúne un trozo partido por la mitad entre dos paquetes de red', async () => {
    respuestas.push(async (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const linea = trozo('partido')
      res.write(linea.slice(0, 20))
      await esperar(30)
      res.write(linea.slice(20))
      res.write('data: [DONE]\n\n')
      res.end()
    })
    const m = recolector()
    await crear().enviar({ texto: 'x' }, m)
    expect(m.texto()).toBe('partido')
  })

  it('cancelar detiene la respuesta, conserva lo mostrado y deja seguir la conversación', async () => {
    respuestas.push(async (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (let i = 0; i < 200; i++) {
        if (res.destroyed || res.writableEnded) return
        res.write(trozo(`p${i} `))
        await esperar(20)
      }
      res.end()
    }, flujo(['ok']))
    const p = crear()
    const m = recolector()
    const envio = p.enviar({ texto: 'cuenta' }, m)
    await esperarHasta(() => m.textos.length > 0)
    p.cancelar()
    expect((await envio).motivo).toBe('cancelado')

    await p.enviar({ texto: 'sigue' }, recolector())
    const mensajes = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: string }>
    expect(mensajes.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(mensajes[2].content).toContain('p0')
  })

  it('rechaza un segundo envío mientras hay una respuesta en curso', async () => {
    respuestas.push(flujo(['uno', 'dos', 'tres', 'cuatro']))
    const p = crear()
    const primero = p.enviar({ texto: 'a' }, recolector())
    const e = await errorDe(p.enviar({ texto: 'b' }, recolector()))
    expect(e.error.codigo).toBe('solicitud_invalida')
    await primero
  })

  it('si el servidor deja de hablar a mitad, falla por tiempo agotado', async () => {
    respuestas.push(async (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(trozo('empiezo'))
      // y se queda en silencio
    })
    const e = await errorDe(crear({ silencioMaxMs: 150 }).enviar({ texto: 'x' }, recolector()))
    expect(e.error.codigo).toBe('tiempo_agotado')
  })

  it('si el servidor no contesta ni a la conexión, falla por tiempo agotado', async () => {
    respuestas.push(() => new Promise(() => undefined))
    const e = await errorDe(crear({ conexionMaxMs: 150 }).enviar({ texto: 'x' }, recolector()))
    expect(e.error.codigo).toBe('tiempo_agotado')
  })

  it('un error enviado dentro del flujo se traduce', async () => {
    respuestas.push(async (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ error: { message: 'el servicio se cayó' } })}\n\n`)
      res.end()
    })
    const e = await errorDe(crear().enviar({ texto: 'x' }, recolector()))
    expect(e.error.codigo).toBe('sobrecarga')
    expect(e.error.detalle).toContain('el servicio se cayó')
  })
})

describe('ProveedorOpenai: errores', () => {
  it.each([
    [401, { error: { message: 'Incorrect API key' } }, 'clave_invalida'],
    [403, { error: { message: 'forbidden' } }, 'cuenta'],
    [404, { error: { message: 'The model `x` does not exist' } }, 'modelo'],
    [400, { error: { message: 'The model `gpt-9` does not exist' } }, 'modelo'],
    [429, { error: { message: 'Rate limit reached' } }, 'limite_uso'],
    [429, { error: { message: 'You exceeded your current quota, please check your billing' } }, 'limite_uso'],
    [500, { error: { message: 'oops' } }, 'sobrecarga'],
    [503, 'Service Unavailable', 'sobrecarga'],
    [504, 'gateway timeout', 'tiempo_agotado'],
    [400, { error: { message: 'messages: invalid' } }, 'solicitud_invalida']
  ])('HTTP %i → %s', async (estado, cuerpo, codigo) => {
    respuestas.push(errorHttp(estado, cuerpo))
    const e = await errorDe(crear().enviar({ texto: 'x' }, recolector()))
    expect(e.error.codigo).toBe(codigo)
    expect(e.error.detalle).toContain(`HTTP ${estado}`)
  })

  it('explica que el modelo no admite imágenes', async () => {
    respuestas.push(errorHttp(400, { error: { message: 'This model does not support image inputs' } }))
    const e = await errorDe(
      crear().enviar({ texto: 'x', contexto: { imagen: { tipoMime: 'image/jpeg', base64: 'AAAA', ancho: 1, alto: 1 } } }, recolector())
    )
    expect(e.error.mensaje).toMatch(/no admite imágenes/)
  })

  it('el mensaje de la clave rechazada habla de ORBE_OPENAI_KEY y el de saldo, de la cuenta', () => {
    expect(errorDesdeHttp(401, '{}').error.mensaje).toContain('ORBE_OPENAI_KEY')
    expect(errorDesdeHttp(429, JSON.stringify({ error: { message: 'insufficient_quota' } })).error.mensaje).toMatch(/saldo|cuota/)
  })

  it('sin conexión con el servidor: error claro de conexión', async () => {
    const e = await errorDe(crear({ url: 'http://127.0.0.1:1/v1' }).enviar({ texto: 'x' }, recolector()))
    expect(e.error.codigo).toBe('sin_conexion')
  })

  it('sin modelo configurado, lo dice antes de llamar a nadie', async () => {
    const e = await errorDe(crear({ modelo: '' }).enviar({ texto: 'x' }, recolector()))
    expect(e.error.mensaje).toContain('ORBE_MODELO')
    expect(recibidas).toHaveLength(0)
  })

  it('con el servicio oficial y sin clave, pide la clave sin llegar a conectar', async () => {
    const e = await errorDe(crear({ url: 'https://api.openai.com/v1', clave: '' }).enviar({ texto: 'x' }, recolector()))
    expect(e.error.codigo).toBe('clave_invalida')
    expect(e.error.mensaje).toContain('ORBE_OPENAI_KEY')
  })

  it('un error en el primer intento no deja la conversación a medias', async () => {
    respuestas.push(errorHttp(500, { error: { message: 'x' } }), flujo(['ok']))
    const p = crear()
    await errorDe(p.enviar({ texto: 'primero' }, recolector()))
    await p.enviar({ texto: 'segundo' }, recolector())
    const mensajes = recibidas[1].cuerpo['messages'] as Array<{ role: string }>
    expect(mensajes.map((m) => m.role)).toEqual(['system', 'user'])
  })
})

describe('configuración del proveedor openai', () => {
  it('se elige con ORBE_PROVEEDOR=openai y no se activa solo', () => {
    expect(resolverConfig({ ORBE_OPENAI_KEY: 'k' }, {}).proveedor).toBe('cli')
    const c = resolverConfig({ ORBE_PROVEEDOR: 'openai', ORBE_MODELO: 'gpt-4o-mini', ORBE_OPENAI_KEY: 'k' }, {})
    expect(c).toMatchObject({ proveedor: 'openai', modelo: 'gpt-4o-mini', openaiKey: 'k', openaiUrl: 'https://api.openai.com/v1' })
  })

  it('con openai el modelo hay que elegirlo (el de Claude no existiría allí) y avisa si falta', () => {
    const c = resolverConfig({ ORBE_PROVEEDOR: 'openai' }, {})
    expect(c.modelo).toBe('')
    expect(c.avisos.join(' ')).toContain('ORBE_MODELO')
  })

  it('admite otra dirección (Groq, OpenRouter, Ollama…) y la clave estándar OPENAI_API_KEY', () => {
    const c = resolverConfig({ ORBE_PROVEEDOR: 'openai', ORBE_MODELO: 'llama3', ORBE_OPENAI_URL: 'http://localhost:11434/v1' }, { OPENAI_API_KEY: 'del-entorno' })
    expect(c.openaiUrl).toBe('http://localhost:11434/v1')
    expect(c.openaiKey).toBe('del-entorno')
  })

  it('la clave de OpenAI no se expone si el proveedor no es openai', () => {
    expect(resolverConfig({ ORBE_OPENAI_KEY: 'k' }, {}).openaiKey).toBe('')
  })

  it('el proveedor inválido avisa y menciona las cuatro opciones', () => {
    expect(resolverConfig({ ORBE_PROVEEDOR: 'nube' }, {}).avisos[0]).toContain('auto, cli, api, openai')
  })
})
