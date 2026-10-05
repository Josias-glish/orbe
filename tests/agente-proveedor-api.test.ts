import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AccionVista, FuenteVista } from '../src/shared/tipos'
import { RegistroHerramientas } from '../src/main/agente/registro'
import type { Herramienta, PeticionConfirmacion } from '../src/main/agente/tipos'
import { ErrorChat } from '../src/main/chat/errores'
import { PROMPT_SISTEMA } from '../src/main/chat/prompt-sistema'
import type { ManejadoresTurno } from '../src/main/chat/proveedor'
import { MARCA_DETENIDO, ProveedorApi, compactarResultadosAntiguos, repararHistorialCancelado, type OpcionesProveedorApi } from '../src/main/chat/proveedor-api'
import { eco, nuncaTermina } from './agente-fixtures'

interface Recibida {
  cuerpo: Record<string, any>
}
type Respuesta = (res: ServerResponse) => void | Promise<void>

interface Cita {
  url: string
  title: string
  cited_text?: string
}
interface ResultadoWeb {
  title: string
  url: string
}
type Bloque =
  | { texto: string; citas?: Cita[] }
  | { herramienta: string; id: string; entrada: unknown }
  /** Claude pide una búsqueda web (la ejecuta el servidor de Anthropic). */
  | { busqueda: string; id: string }
  /** El resultado de esa búsqueda, tal como lo devuelve el servidor (con el contenido cifrado). */
  | { resultados: ResultadoWeb[]; id: string }
  | { errorBusqueda: string; id: string }

let servidor: Server
let puerto: number
let recibidas: Recibida[]
let respuestas: Respuesta[]
let proveedores: ProveedorApi[]

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function esperarHasta(condicion: () => boolean, maximoMs = 5000): Promise<void> {
  const limite = Date.now() + maximoMs
  while (!condicion() && Date.now() < limite) await esperar(10)
}

function evento(res: ServerResponse, nombre: string, datos: unknown): void {
  res.write(`event: ${nombre}\ndata: ${JSON.stringify(datos)}\n\n`)
}

function inicioMensaje(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  evento(res, 'message_start', {
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
}

/** Una respuesta en streaming con bloques de texto y de herramienta, en el formato de eventos de Anthropic. */
function respuesta(bloques: Bloque[], parada = 'end_turn', detalles?: unknown): Respuesta {
  return async (res) => {
    inicioMensaje(res)
    for (const [index, bloque] of bloques.entries()) {
      if ('texto' in bloque) {
        evento(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
        evento(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: bloque.texto } })
        for (const c of bloque.citas ?? []) {
          evento(res, 'content_block_delta', {
            type: 'content_block_delta',
            index,
            delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', encrypted_index: 'ei', cited_text: 'texto citado', ...c } }
          })
        }
      } else if ('busqueda' in bloque) {
        evento(res, 'content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'server_tool_use', id: bloque.id, name: 'web_search', input: {} }
        })
        evento(res, 'content_block_delta', {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify({ query: bloque.busqueda }) }
        })
      } else if ('resultados' in bloque || 'errorBusqueda' in bloque) {
        // Los resultados de la búsqueda llegan enteros en el bloque de inicio.
        const contenido =
          'resultados' in bloque
            ? bloque.resultados.map((r) => ({ type: 'web_search_result', title: r.title, url: r.url, page_age: null, encrypted_content: `cifrado-de-${r.url}` }))
            : { type: 'web_search_tool_result_error', error_code: bloque.errorBusqueda }
        evento(res, 'content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'web_search_tool_result', tool_use_id: bloque.id, content: contenido }
        })
      } else {
        evento(res, 'content_block_start', {
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: bloque.id, name: bloque.herramienta, input: {} }
        })
        const json = JSON.stringify(bloque.entrada)
        const mitad = Math.floor(json.length / 2)
        for (const parcial of [json.slice(0, mitad), json.slice(mitad)]) {
          evento(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: parcial } })
        }
      }
      evento(res, 'content_block_stop', { type: 'content_block_stop', index })
      await esperar(2)
    }
    evento(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: parada, stop_sequence: null, ...(detalles ? { stop_details: detalles } : {}) },
      usage: { output_tokens: 12 }
    })
    evento(res, 'message_stop', { type: 'message_stop' })
    res.end()
  }
}

const usaEco = (texto: string, id = 'toolu_1'): Bloque => ({ herramienta: 'eco', id, entrada: { texto } })

/** Una respuesta que empieza y se queda esperando hasta que el cliente cuelga. */
const respuestaColgada: Respuesta = async (res) => {
  inicioMensaje(res)
  evento(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  evento(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Pensando' } })
  await new Promise<void>((r) => res.on('close', () => r()))
}

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const trozos: Buffer[] = []
    req.on('data', (t) => trozos.push(t))
    req.on('end', () => {
      recibidas.push({ cuerpo: JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}') })
      const siguiente = respuestas.shift()
      if (!siguiente) {
        res.writeHead(500).end('sin respuesta preparada')
        return
      }
      void siguiente(res)
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

function crear(herramientas: Herramienta[] = [], extra: Partial<OpcionesProveedorApi> = {}, maxPasos = 15): ProveedorApi {
  const p = new ProveedorApi({
    apiKey: 'sk-ant-de-prueba',
    modelo: 'claude-sonnet-5-5',
    esfuerzo: 'medium',
    baseURL: `http://127.0.0.1:${puerto}`,
    maxRetries: 0,
    timeoutMs: 5000,
    agente: { registro: new RegistroHerramientas(herramientas), maxPasos, permitirLocal: false },
    ...extra
  })
  proveedores.push(p)
  return p
}

/** Un proveedor con la búsqueda web de Claude (y, si se dan, herramientas propias). */
function crearConBusqueda(maxUsos = 5, herramientas: Herramienta[] = []): ProveedorApi {
  return crear([], {
    agente: { registro: new RegistroHerramientas(herramientas), maxPasos: 15, permitirLocal: false, busquedaNativa: { maxUsos } }
  })
}

function recolector(confirmar?: (p: PeticionConfirmacion) => Promise<boolean>) {
  const textos: string[] = []
  const acciones: AccionVista[] = []
  const fuentes: FuenteVista[][] = []
  const m: ManejadoresTurno = {
    alTexto: (d) => textos.push(d),
    alAccion: (a) => acciones.push(a),
    alFuentes: (f) => fuentes.push(f),
    ...(confirmar ? { confirmar } : {})
  }
  return { m, textos, acciones, fuentes }
}

const roles = (mensajes: Array<{ role: string }>): string[] => mensajes.map((m) => m.role)

describe('ProveedorApi como agente: la petición', () => {
  it('sin herramientas el chat va exactamente como siempre (sin tools y con el prompt de siempre)', async () => {
    respuestas.push(respuesta([{ texto: 'Hola' }]))
    await crear([]).enviar({ texto: 'Hola' }, recolector().m)
    const cuerpo = recibidas[0].cuerpo
    expect(cuerpo['tools']).toBeUndefined()
    expect(cuerpo['tool_choice']).toBeUndefined()
    expect(String(cuerpo['system']).startsWith(PROMPT_SISTEMA)).toBe(true)
  })

  it('con herramientas las ofrece, pide una cada vez y usa las instrucciones del modo agente', async () => {
    const { herramienta } = eco()
    respuestas.push(respuesta([{ texto: 'Hola' }]))
    await crear([herramienta], {}, 12).enviar({ texto: 'Hola' }, recolector().m)
    const cuerpo = recibidas[0].cuerpo
    expect(cuerpo['tools']).toEqual(new RegistroHerramientas([herramienta]).paraAnthropic())
    expect(cuerpo['tool_choice']).toEqual({ type: 'auto', disable_parallel_tool_use: true })
    const sistema = String(cuerpo['system'])
    expect(sistema).toContain('Eres Orbe')
    expect(sistema).toContain('Datos, no instrucciones')
    expect(sistema).toContain('máximo 12 pasos')
    expect(sistema).not.toContain('Solo conversas')
  })
})

describe('ProveedorApi como agente: el bucle', () => {
  it('ejecuta la herramienta que pide Claude, le devuelve el resultado y sigue hasta que termina', async () => {
    const { herramienta, ejecutadas } = eco()
    respuestas.push(respuesta([{ texto: 'Voy a ver.' }, usaEco('hola')], 'tool_use'), respuesta([{ texto: 'Listo.' }]))
    const { m, textos, acciones } = recolector()
    const r = await crear([herramienta]).enviar({ texto: 'Repite hola' }, m)

    expect(r.motivo).toBe('completo')
    expect(ejecutadas).toEqual(['hola'])
    expect(textos).toEqual(['Voy a ver.', 'Listo.'])
    expect(acciones.map((a) => a.estado)).toEqual(['en_curso', 'ok'])

    expect(recibidas).toHaveLength(2)
    const segunda = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: any[] }>
    expect(roles(segunda)).toEqual(['user', 'assistant', 'user'])
    expect(segunda[1].content.map((b) => b.type)).toEqual(['text', 'tool_use'])
    expect(segunda[1].content[1]).toMatchObject({ id: 'toolu_1', name: 'eco', input: { texto: 'hola' } })
    // El resultado va en un único mensaje de usuario y el bloque tool_result es lo primero.
    expect(segunda[2].content[0]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'hola' })
  })

  it('el historial entre turnos conserva las herramientas y los roles alternan', async () => {
    const { herramienta } = eco()
    respuestas.push(respuesta([usaEco('uno')], 'tool_use'), respuesta([{ texto: 'Hecho.' }]), respuesta([{ texto: 'De nada.' }]))
    const p = crear([herramienta])
    await p.enviar({ texto: 'Primero' }, recolector().m)
    await p.enviar({ texto: 'Gracias' }, recolector().m)
    const tercera = recibidas[2].cuerpo['messages'] as Array<{ role: string }>
    expect(roles(tercera)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
  })

  it('una herramienta que no existe llega a Claude como error, no rompe el turno', async () => {
    const { herramienta } = eco()
    respuestas.push(respuesta([{ herramienta: 'borrar_todo', id: 'toolu_9', entrada: {} }], 'tool_use'), respuesta([{ texto: 'No puedo.' }]))
    const r = await crear([herramienta]).enviar({ texto: 'Borra' }, recolector().m)
    expect(r.motivo).toBe('completo')
    const segunda = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: any[] }>
    expect(segunda[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_9', is_error: true })
    expect(segunda[2].content[0].content).toMatch(/No existe la herramienta/)
  })

  it('con parámetros inválidos no ejecuta y se lo dice a Claude', async () => {
    const { herramienta, ejecutadas } = eco()
    respuestas.push(respuesta([{ herramienta: 'eco', id: 'toolu_2', entrada: { texto: 7 } }], 'tool_use'), respuesta([{ texto: 'Vale.' }]))
    await crear([herramienta]).enviar({ texto: 'x' }, recolector().m)
    expect(ejecutadas).toEqual([])
    const segunda = recibidas[1].cuerpo['messages'] as Array<{ content: any[] }>
    expect(segunda[2].content[0]).toMatchObject({ is_error: true })
    expect(segunda[2].content[0].content).toMatch(/Parámetros no válidos/)
  })

  it('si el usuario no permite una acción, Claude recibe la negativa', async () => {
    const { herramienta, ejecutadas } = eco({ nivel: 'confirmar' })
    respuestas.push(respuesta([usaEco('enviar')], 'tool_use'), respuesta([{ texto: 'Entendido.' }]))
    const { m, acciones } = recolector(async () => false)
    await crear([herramienta]).enviar({ texto: 'x' }, m)
    expect(ejecutadas).toEqual([])
    expect(acciones.map((a) => a.estado)).toEqual(['en_curso', 'denegada'])
    const segunda = recibidas[1].cuerpo['messages'] as Array<{ content: any[] }>
    expect(segunda[2].content[0]).toMatchObject({ is_error: true })
    expect(segunda[2].content[0].content).toMatch(/no permitió/)
  })

  it('límite de pasos: ejecuta solo los permitidos y pide un resumen sin herramientas', async () => {
    const { herramienta, ejecutadas } = eco()
    respuestas.push(
      respuesta([usaEco('uno', 'toolu_1')], 'tool_use'),
      respuesta([usaEco('dos', 'toolu_2')], 'tool_use'),
      respuesta([{ texto: 'Resumen de lo hecho.' }])
    )
    const { m, textos } = recolector()
    const r = await crear([herramienta], {}, 1).enviar({ texto: 'x' }, m)
    expect(r.motivo).toBe('limite_pasos')
    expect(ejecutadas).toEqual(['uno'])
    expect(textos).toContain('Resumen de lo hecho.')
    expect(recibidas).toHaveLength(3)
    expect(recibidas[2].cuerpo['tool_choice']).toEqual({ type: 'none' })
    expect(recibidas[2].cuerpo['tools']).toBeDefined() // el historial lleva herramientas: la API exige tenerlas definidas
    const tercera = recibidas[2].cuerpo['messages'] as Array<{ role: string; content: any[] }>
    expect(tercera[tercera.length - 1].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_2', is_error: true })
    expect(tercera[tercera.length - 1].content[0].content).toMatch(/límite de pasos/)
  })

  it('una pausa de la API (pause_turn) se continúa reenviando lo recibido, sin mensaje de usuario nuevo', async () => {
    const { herramienta } = eco()
    respuestas.push(respuesta([{ texto: 'Buscando…' }], 'pause_turn'), respuesta([{ texto: ' Ya está.' }]))
    const { m, textos } = recolector()
    const r = await crear([herramienta]).enviar({ texto: 'Busca algo' }, m)
    expect(r.motivo).toBe('completo')
    expect(textos).toEqual(['Buscando…', ' Ya está.'])
    const segunda = recibidas[1].cuerpo['messages'] as Array<{ role: string }>
    expect(roles(segunda)).toEqual(['user', 'assistant'])
  })

  it('una respuesta cortada por longitud con una herramienta a medias no deja un tool_use suelto en el historial', async () => {
    const { herramienta, ejecutadas } = eco()
    respuestas.push(respuesta([{ texto: 'abc' }, usaEco('x')], 'max_tokens'), respuesta([{ texto: 'Sigo.' }]))
    const p = crear([herramienta])
    const r = await p.enviar({ texto: 'Largo' }, recolector().m)
    expect(r.motivo).toBe('limite_tokens')
    expect(ejecutadas).toEqual([])
    await p.enviar({ texto: 'Continúa' }, recolector().m)
    const segunda = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: any }>
    expect(roles(segunda)).toEqual(['user', 'assistant', 'user'])
    expect(JSON.stringify(segunda[1].content)).not.toContain('tool_use')
  })

  it('una negativa del modelo (refusal) es un error y no cambia el historial', async () => {
    const { herramienta } = eco()
    respuestas.push(respuesta([{ texto: '' }], 'refusal', { category: 'cyber' }), respuesta([{ texto: 'Hola.' }]))
    const p = crear([herramienta])
    await expect(p.enviar({ texto: 'x' }, recolector().m)).rejects.toBeInstanceOf(ErrorChat)
    await p.enviar({ texto: 'otra cosa' }, recolector().m)
    const segunda = recibidas[1].cuerpo['messages'] as Array<{ role: string }>
    expect(roles(segunda)).toEqual(['user'])
  })

  it('los resultados largos de rondas antiguas se recortan; los recientes se conservan', async () => {
    const largo = 'x'.repeat(2000)
    const { herramienta } = eco({ ejecutar: async () => ({ texto: largo }) })
    for (let i = 1; i <= 5; i++) respuestas.push(respuesta([usaEco(`n${i}`, `toolu_${i}`)], 'tool_use'))
    respuestas.push(respuesta([{ texto: 'Fin.' }]))
    await crear([herramienta]).enviar({ texto: 'muchas veces' }, recolector().m)
    const ultima = recibidas[5].cuerpo['messages'] as Array<{ role: string; content: any[] }>
    const resultados = ultima.filter((m) => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result').map((m) => m.content[0].content as string)
    expect(resultados).toHaveLength(5)
    expect(resultados.slice(0, 2).every((c) => c.startsWith('[Resultado anterior omitido'))).toBe(true)
    expect(resultados.slice(2).every((c) => c === largo)).toBe(true)
  })
})

describe('ProveedorApi como agente: Detener', () => {
  it('detener en mitad de una herramienta corta al instante, y el historial queda válido para seguir', async () => {
    let iniciada = false
    const { herramienta } = eco({
      ejecutar: async () => {
        iniciada = true
        return nuncaTermina()
      }
    })
    respuestas.push(respuesta([usaEco('colgada', 'toolu_c')], 'tool_use'))
    const p = crear([herramienta])
    const { m, acciones } = recolector()
    const turno = p.enviar({ texto: 'Haz algo largo' }, m)
    await esperarHasta(() => iniciada)
    p.cancelar()
    const r = await turno
    expect(r.motivo).toBe('cancelado')
    expect(acciones.map((a) => a.estado)).toEqual(['en_curso', 'cancelada'])

    respuestas.push(respuesta([{ texto: 'Aquí estoy.' }]))
    await p.enviar({ texto: 'Sigamos' }, recolector().m)
    const mensajes = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: any }>
    expect(roles(mensajes)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    expect(mensajes[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_c', is_error: true, content: 'Cancelado por el usuario.' })
    expect(mensajes[3].content).toBe(MARCA_DETENIDO)
  })

  it('detener mientras Claude escribe también deja el historial válido', async () => {
    const { herramienta } = eco()
    respuestas.push(respuestaColgada)
    const p = crear([herramienta])
    const { m, textos } = recolector()
    const turno = p.enviar({ texto: 'Cuéntame algo' }, m)
    await esperarHasta(() => textos.length > 0)
    p.cancelar()
    expect((await turno).motivo).toBe('cancelado')

    respuestas.push(respuesta([{ texto: 'Dime.' }]))
    await p.enviar({ texto: 'Perdona' }, recolector().m)
    const mensajes = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: any }>
    expect(roles(mensajes)).toEqual(['user', 'assistant', 'user'])
    expect(mensajes[1].content).toBe(MARCA_DETENIDO)
  })

  it('detener mientras se espera el permiso del usuario cancela la acción', async () => {
    const { herramienta, ejecutadas } = eco({ nivel: 'confirmar' })
    respuestas.push(respuesta([usaEco('x')], 'tool_use'))
    const p = crear([herramienta])
    let preguntada = false
    const { m, acciones } = recolector(() => {
      preguntada = true
      return nuncaTermina()
    })
    const turno = p.enviar({ texto: 'x' }, m)
    await esperarHasta(() => preguntada)
    p.cancelar()
    expect((await turno).motivo).toBe('cancelado')
    expect(ejecutadas).toEqual([])
    expect(acciones.map((a) => a.estado)).toEqual(['en_curso', 'cancelada'])
  })
})

/** Una respuesta con una búsqueda ya pedida que no termina hasta que el cliente cuelga. */
const respuestaBusquedaColgada: Respuesta = async (res) => {
  inicioMensaje(res)
  evento(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'server_tool_use', id: 'srvtoolu_c', name: 'web_search', input: {} }
  })
  evento(res, 'content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: JSON.stringify({ query: 'lo que no termina' }) }
  })
  evento(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  await new Promise<void>((r) => res.on('close', () => r()))
}

const RESULTADOS: ResultadoWeb[] = [
  { title: 'El tiempo en Lima', url: 'https://www.ejemplo.org/lima' },
  { title: 'Previsión semanal', url: 'https://clima.example.com/lima' },
  { title: 'Otra página', url: 'https://otra.example.net/pagina' }
]

describe('ProveedorApi con la búsqueda web de Claude', () => {
  it('ofrece la búsqueda del servidor aunque no haya herramientas propias, con su tope y las instrucciones de búsqueda', async () => {
    respuestas.push(respuesta([{ texto: 'Hola' }]))
    await crearConBusqueda(3).enviar({ texto: 'Hola' }, recolector().m)
    const cuerpo = recibidas[0].cuerpo
    expect(cuerpo['tools']).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }])
    expect(cuerpo['tool_choice']).toEqual({ type: 'auto', disable_parallel_tool_use: true })
    expect(String(cuerpo['system'])).toContain('Puedes buscar en internet')
  })

  it('la búsqueda va junto a las herramientas propias, y sin búsqueda las instrucciones no la mencionan', async () => {
    const { herramienta } = eco()
    respuestas.push(respuesta([{ texto: 'Hola' }]), respuesta([{ texto: 'Hola' }]))
    await crearConBusqueda(5, [herramienta]).enviar({ texto: 'Hola' }, recolector().m)
    expect(recibidas[0].cuerpo['tools']).toEqual([...new RegistroHerramientas([herramienta]).paraAnthropic(), { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }])

    await crear([herramienta]).enviar({ texto: 'Hola' }, recolector().m)
    expect(String(recibidas[1].cuerpo['system'])).not.toContain('Puedes buscar en internet')
  })

  it('cuenta cada búsqueda en el chat y enseña como fuentes solo los enlaces que Claude citó', async () => {
    respuestas.push(
      respuesta([
        { texto: 'Voy a buscarlo.' },
        { busqueda: 'tiempo en Lima', id: 'srvtoolu_1' },
        { resultados: RESULTADOS, id: 'srvtoolu_1' },
        { texto: 'Hay 19 °C.', citas: [{ url: RESULTADOS[0].url, title: RESULTADOS[0].title }, { url: RESULTADOS[0].url, title: RESULTADOS[0].title }] }
      ])
    )
    const { m, acciones, fuentes } = recolector()
    const r = await crearConBusqueda().enviar({ texto: '¿Qué tiempo hace en Lima?' }, m)

    expect(r.motivo).toBe('completo')
    expect(recibidas).toHaveLength(1)
    expect(acciones.map((a) => [a.accionId, a.estado, a.titulo])).toEqual([
      ['busqueda-srvtoolu_1', 'en_curso', 'Buscando: tiempo en Lima'],
      ['busqueda-srvtoolu_1', 'ok', 'Buscando: tiempo en Lima']
    ])
    expect(acciones[1].resultado).toMatch(/^3 resultados: El tiempo en Lima/)
    expect(acciones[0].parametros).toBe('{"consulta":"tiempo en Lima"}')
    expect(fuentes).toEqual([[{ titulo: 'El tiempo en Lima', url: 'https://www.ejemplo.org/lima' }]])
  })

  it('si Claude no cita nada, las fuentes son los resultados de la búsqueda', async () => {
    respuestas.push(respuesta([{ busqueda: 'algo', id: 'srvtoolu_1' }, { resultados: RESULTADOS, id: 'srvtoolu_1' }, { texto: 'Listo.' }]))
    const { m, fuentes } = recolector()
    await crearConBusqueda().enviar({ texto: 'x' }, m)
    expect(fuentes[0].map((f) => f.url)).toEqual(RESULTADOS.map((r) => r.url))
  })

  it('un enlace que no es web o trae usuario y contraseña nunca llega como fuente', async () => {
    const malos: ResultadoWeb[] = [
      { title: 'js', url: 'javascript:alert(1)' },
      { title: 'archivo', url: 'file:///C:/secreto.txt' },
      { title: 'credenciales', url: 'https://usuario:clave@ejemplo.org/' },
      { title: 'bueno', url: 'https://ejemplo.org/bueno#parte' }
    ]
    respuestas.push(respuesta([{ busqueda: 'x', id: 'srvtoolu_1' }, { resultados: malos, id: 'srvtoolu_1' }, { texto: 'Listo.' }]))
    const { m, fuentes } = recolector()
    await crearConBusqueda().enviar({ texto: 'x' }, m)
    expect(fuentes).toEqual([[{ titulo: 'bueno', url: 'https://ejemplo.org/bueno' }]])
  })

  it('el historial conserva los bloques de la búsqueda tal como llegaron, que es lo que la API exige para seguir', async () => {
    respuestas.push(
      respuesta([
        { busqueda: 'tiempo en Lima', id: 'srvtoolu_1' },
        { resultados: RESULTADOS, id: 'srvtoolu_1' },
        { texto: 'Hay 19 °C.', citas: [{ url: RESULTADOS[0].url, title: RESULTADOS[0].title }] }
      ]),
      respuesta([{ texto: 'De nada.' }])
    )
    const p = crearConBusqueda()
    await p.enviar({ texto: '¿Qué tiempo hace?' }, recolector().m)
    await p.enviar({ texto: 'Gracias' }, recolector().m)

    const segunda = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: any[] }>
    expect(roles(segunda)).toEqual(['user', 'assistant', 'user'])
    expect(segunda[1].content.map((b) => b.type)).toEqual(['server_tool_use', 'web_search_tool_result', 'text'])
    expect(segunda[1].content[0]).toMatchObject({ id: 'srvtoolu_1', name: 'web_search', input: { query: 'tiempo en Lima' } })
    expect(segunda[1].content[1].content[0]).toMatchObject({ type: 'web_search_result', url: RESULTADOS[0].url, encrypted_content: `cifrado-de-${RESULTADOS[0].url}` })
    expect(segunda[1].content[2].citations[0]).toMatchObject({ type: 'web_search_result_location', url: RESULTADOS[0].url, encrypted_index: 'ei' })
  })

  it('una pausa en mitad de una búsqueda se continúa reenviando lo recibido, sin pedir nada al usuario', async () => {
    respuestas.push(
      respuesta([{ busqueda: 'tema largo', id: 'srvtoolu_1' }, { resultados: RESULTADOS, id: 'srvtoolu_1' }], 'pause_turn'),
      respuesta([{ texto: 'Ya lo tengo.' }])
    )
    const { m, textos } = recolector()
    const r = await crearConBusqueda().enviar({ texto: 'Investiga' }, m)
    expect(r.motivo).toBe('completo')
    expect(textos).toEqual(['Ya lo tengo.'])
    const segunda = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: any[] }>
    expect(roles(segunda)).toEqual(['user', 'assistant'])
    expect(segunda[1].content.map((b) => b.type)).toEqual(['server_tool_use', 'web_search_tool_result'])
  })

  it('un fallo de la búsqueda se ve como error en su línea y Claude sigue con lo que tiene', async () => {
    respuestas.push(respuesta([{ busqueda: 'x', id: 'srvtoolu_1' }, { errorBusqueda: 'max_uses_exceeded', id: 'srvtoolu_1' }, { texto: 'No pude buscar.' }]))
    const { m, acciones, fuentes } = recolector()
    const r = await crearConBusqueda().enviar({ texto: 'x' }, m)
    expect(r.motivo).toBe('completo')
    expect(acciones.map((a) => a.estado)).toEqual(['en_curso', 'error'])
    expect(acciones[1].resultado).toMatch(/máximo de búsquedas/)
    expect(fuentes).toEqual([])
  })

  it('mezclada con una herramienta propia: se ejecuta la nuestra y el resultado va primero en el mensaje del usuario', async () => {
    const { herramienta, ejecutadas } = eco()
    respuestas.push(
      respuesta([{ busqueda: 'x', id: 'srvtoolu_1' }, { resultados: RESULTADOS, id: 'srvtoolu_1' }, usaEco('hola')], 'tool_use'),
      respuesta([{ texto: 'Hecho.' }])
    )
    await crearConBusqueda(5, [herramienta]).enviar({ texto: 'x' }, recolector().m)
    expect(ejecutadas).toEqual(['hola'])
    const segunda = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: any[] }>
    expect(segunda[1].content.map((b) => b.type)).toEqual(['server_tool_use', 'web_search_tool_result', 'tool_use'])
    expect(segunda[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'hola' })
  })

  it('una respuesta cortada por longitud a mitad de una búsqueda no deja una petición de búsqueda sin resultado', async () => {
    respuestas.push(respuesta([{ texto: 'Busco.' }, { busqueda: 'x', id: 'srvtoolu_1' }], 'max_tokens'), respuesta([{ texto: 'Sigo.' }]))
    const p = crearConBusqueda()
    expect((await p.enviar({ texto: 'x' }, recolector().m)).motivo).toBe('limite_tokens')
    await p.enviar({ texto: 'Continúa' }, recolector().m)
    const segunda = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: any }>
    expect(roles(segunda)).toEqual(['user', 'assistant', 'user'])
    expect(JSON.stringify(segunda[1].content)).not.toContain('server_tool_use')
  })

  it('detener mientras Claude busca corta la tarea, deja la línea sin terminar y el historial sigue siendo válido', async () => {
    respuestas.push(respuestaBusquedaColgada)
    const p = crearConBusqueda()
    const { m, acciones } = recolector()
    const turno = p.enviar({ texto: 'Busca algo' }, m)
    await esperarHasta(() => acciones.length > 0)
    p.cancelar()
    expect((await turno).motivo).toBe('cancelado')
    expect(acciones.map((a) => a.estado)).toEqual(['en_curso'])

    respuestas.push(respuesta([{ texto: 'Aquí sigo.' }]))
    await p.enviar({ texto: 'Perdona' }, recolector().m)
    const mensajes = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: any }>
    expect(roles(mensajes)).toEqual(['user', 'assistant', 'user'])
    expect(mensajes[1].content).toBe(MARCA_DETENIDO)
  })

  it('si la cuenta no tiene la búsqueda activada, el error lo explica y dice cómo seguir sin ella', async () => {
    respuestas.push(async (res) => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'The web_search tool is not enabled for this organization.' } }))
    })
    const fallo = await crearConBusqueda()
      .enviar({ texto: 'x' }, recolector().m)
      .catch((e: unknown) => e)
    expect(fallo).toBeInstanceOf(ErrorChat)
    expect((fallo as ErrorChat).error.mensaje).toMatch(/búsqueda web no está activada.*ORBE_BUSQUEDA_MAX=0/)
  })

  it('un 400 que no habla de la búsqueda no se confunde con eso', async () => {
    respuestas.push(async (res) => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'messages: otra cosa distinta' } }))
    })
    const fallo = await crearConBusqueda()
      .enviar({ texto: 'x' }, recolector().m)
      .catch((e: unknown) => e)
    expect((fallo as ErrorChat).error.mensaje).not.toMatch(/ORBE_BUSQUEDA_MAX/)
  })
})

describe('historial del agente: funciones puras', () => {
  const resultado = (id: string, contenido = 'listo'): { id: string; contenido: string; esError: boolean } => ({ id, contenido, esError: false })

  it('repararHistorialCancelado contesta todas las herramientas pedidas, con lo obtenido o como «cancelado»', () => {
    const mensajes: any[] = [
      { role: 'user', content: 'hola' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'a', name: 'eco', input: {} },
          { type: 'tool_use', id: 'b', name: 'eco', input: {} }
        ]
      }
    ]
    repararHistorialCancelado(mensajes, [resultado('a')])
    expect(mensajes).toHaveLength(4)
    expect(mensajes[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'a', content: 'listo' },
        { type: 'tool_result', tool_use_id: 'b', content: 'Cancelado por el usuario.', is_error: true }
      ]
    })
    expect(mensajes[3]).toEqual({ role: 'assistant', content: MARCA_DETENIDO })
  })

  it('si el último mensaje es del usuario solo añade la marca; si era un turno de asistente a medias, lo quita', () => {
    const a: any[] = [{ role: 'user', content: 'hola' }]
    repararHistorialCancelado(a, [])
    expect(a).toEqual([{ role: 'user', content: 'hola' }, { role: 'assistant', content: MARCA_DETENIDO }])

    const b: any[] = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: [{ type: 'text', text: 'Buscando' }] }
    ]
    repararHistorialCancelado(b, [])
    expect(b).toEqual([{ role: 'user', content: 'hola' }, { role: 'assistant', content: MARCA_DETENIDO }])
  })

  it('compactarResultadosAntiguos deja los cortos y los de las últimas rondas', () => {
    const ronda = (id: string, contenido: string): any => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: contenido }] })
    const mensajes: any[] = [{ role: 'user', content: 'hola' }, ronda('1', 'x'.repeat(3000)), ronda('2', 'corto'), ronda('3', 'x'.repeat(3000)), ronda('4', 'x'.repeat(3000)), ronda('5', 'x'.repeat(3000))]
    compactarResultadosAntiguos(mensajes)
    expect(mensajes[1].content[0].content).toMatch(/omitido/)
    expect(mensajes[2].content[0].content).toBe('corto')
    expect(mensajes[3].content[0].content).toHaveLength(3000)
  })
})
