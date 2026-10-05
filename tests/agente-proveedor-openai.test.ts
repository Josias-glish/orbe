import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AccionVista, FuenteVista } from '../src/shared/tipos'
import type { ProveedorBusqueda } from '../src/main/agente/busqueda'
import { crearBuscarWeb } from '../src/main/agente/herramientas/buscar-web'
import { RegistroHerramientas } from '../src/main/agente/registro'
import type { Herramienta, PeticionConfirmacion } from '../src/main/agente/tipos'
import { ErrorChat } from '../src/main/chat/errores'
import { PROMPT_SISTEMA } from '../src/main/chat/prompt-sistema'
import type { ManejadoresTurno } from '../src/main/chat/proveedor'
import {
  MARCA_DETENIDO,
  ProveedorOpenai,
  compactarResultadosAntiguos,
  errorDesdeHttp,
  repararHistorialCancelado,
  type OpcionesProveedorOpenai
} from '../src/main/chat/proveedor-openai'
import { eco, nuncaTermina } from './agente-fixtures'

interface Recibida {
  cuerpo: Record<string, any>
}
type Respuesta = (res: ServerResponse) => void | Promise<void>

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

const dato = (delta: Record<string, unknown>, fin: string | null = null): string =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`

/** Una petición de herramienta llegando en trozos, como la manda un servicio compatible con OpenAI. */
interface LlamadaFlujo {
  id: string
  nombre: string
  argumentos: string
}

function flujo(texto: string[], llamadas: LlamadaFlujo[] = [], fin?: string): Respuesta {
  return async (res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(dato({ role: 'assistant', content: '' }))
    for (const t of texto) {
      res.write(dato({ content: t }))
      await esperar(2)
    }
    for (const [index, l] of llamadas.entries()) {
      res.write(dato({ tool_calls: [{ index, id: l.id, type: 'function', function: { name: l.nombre, arguments: '' } }] }))
      const mitad = Math.floor(l.argumentos.length / 2)
      for (const parcial of [l.argumentos.slice(0, mitad), l.argumentos.slice(mitad)]) {
        res.write(dato({ tool_calls: [{ index, function: { arguments: parcial } }] }))
        await esperar(2)
      }
    }
    res.write(dato({}, fin ?? (llamadas.length > 0 ? 'tool_calls' : 'stop')))
    res.write('data: [DONE]\n\n')
    res.end()
  }
}

const usaEco = (texto: string, id = 'call_1'): LlamadaFlujo => ({ id, nombre: 'eco', argumentos: JSON.stringify({ texto }) })

const respuestaColgada: Respuesta = async (res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write(dato({ content: 'Pensando' }))
  await new Promise<void>((r) => res.on('close', () => r()))
}

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const partes: Buffer[] = []
    req.on('data', (t) => partes.push(t))
    req.on('end', () => {
      recibidas.push({ cuerpo: JSON.parse(Buffer.concat(partes).toString('utf8') || '{}') })
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

function crear(herramientas: Herramienta[] = [], extra: Partial<OpcionesProveedorOpenai> = {}, maxPasos = 15): ProveedorOpenai {
  const p = new ProveedorOpenai({
    url: `http://127.0.0.1:${puerto}/v1`,
    clave: 'clave-de-prueba',
    modelo: 'modelo-x',
    agente: { registro: new RegistroHerramientas(herramientas), maxPasos, permitirLocal: false },
    ...extra
  })
  proveedores.push(p)
  return p
}

function recolector(confirmar?: (p: PeticionConfirmacion) => Promise<boolean>) {
  const textos: string[] = []
  const acciones: AccionVista[] = []
  const m: ManejadoresTurno = { alTexto: (d) => textos.push(d), alAccion: (a) => acciones.push(a), ...(confirmar ? { confirmar } : {}) }
  return { m, textos, acciones }
}

const roles = (mensajes: Array<Record<string, any>>): string[] => mensajes.map((m) => String(m['role']))

describe('ProveedorOpenai como agente: la petición', () => {
  it('sin herramientas el chat va como siempre: sin tools y con el prompt de siempre', async () => {
    respuestas.push(flujo(['Hola']))
    await crear([]).enviar({ texto: 'Hola' }, recolector().m)
    const cuerpo = recibidas[0].cuerpo
    expect(cuerpo['tools']).toBeUndefined()
    expect(cuerpo['tool_choice']).toBeUndefined()
    expect(String(cuerpo['messages'][0].content).startsWith(PROMPT_SISTEMA)).toBe(true)
  })

  it('con herramientas las ofrece en el formato de funciones y usa las instrucciones del agente', async () => {
    const { herramienta } = eco()
    respuestas.push(flujo(['Hola']))
    await crear([herramienta]).enviar({ texto: 'Hola' }, recolector().m)
    const cuerpo = recibidas[0].cuerpo
    expect(cuerpo['tools']).toEqual(new RegistroHerramientas([herramienta]).paraOpenai())
    expect(cuerpo['tool_choice']).toBeUndefined()
    expect(String(cuerpo['messages'][0].content)).toContain('Datos, no instrucciones')
  })
})

describe('ProveedorOpenai como agente: el bucle', () => {
  it('une los trozos de los parámetros, ejecuta la herramienta y devuelve el resultado como mensaje «tool»', async () => {
    const { herramienta, ejecutadas } = eco()
    respuestas.push(flujo(['Voy a ver.'], [usaEco('hola')]), flujo(['Listo.']))
    const { m, textos, acciones } = recolector()
    const r = await crear([herramienta]).enviar({ texto: 'Repite hola' }, m)

    expect(r.motivo).toBe('completo')
    expect(ejecutadas).toEqual(['hola'])
    expect(textos).toEqual(['Voy a ver.', 'Listo.'])
    expect(acciones.map((a) => a.estado)).toEqual(['en_curso', 'ok'])

    const segunda = recibidas[1].cuerpo['messages'] as Array<Record<string, any>>
    expect(roles(segunda)).toEqual(['system', 'user', 'assistant', 'tool'])
    expect(segunda[2]['tool_calls']).toEqual([{ id: 'call_1', type: 'function', function: { name: 'eco', arguments: '{"texto":"hola"}' } }])
    expect(segunda[3]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'hola' })
  })

  it('el historial entre turnos conserva las herramientas', async () => {
    const { herramienta } = eco()
    respuestas.push(flujo([], [usaEco('uno')]), flujo(['Hecho.']), flujo(['De nada.']))
    const p = crear([herramienta])
    await p.enviar({ texto: 'Primero' }, recolector().m)
    await p.enviar({ texto: 'Gracias' }, recolector().m)
    const tercera = recibidas[2].cuerpo['messages'] as Array<{ role: string }>
    expect(roles(tercera)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user'])
  })

  it('parámetros que no son JSON: no se ejecuta y el modelo recibe el motivo', async () => {
    const { herramienta, ejecutadas } = eco()
    respuestas.push(flujo([], [{ id: 'call_x', nombre: 'eco', argumentos: '{"texto": ' }]), flujo(['Perdona.']))
    await crear([herramienta]).enviar({ texto: 'x' }, recolector().m)
    expect(ejecutadas).toEqual([])
    const segunda = recibidas[1].cuerpo['messages'] as Array<Record<string, any>>
    expect(segunda[3]['content']).toMatch(/JSON válido/)
  })

  it('una herramienta que no existe llega como resultado de error, sin romper el turno', async () => {
    const { herramienta } = eco()
    respuestas.push(flujo([], [{ id: 'call_z', nombre: 'borrar_todo', argumentos: '{}' }]), flujo(['No puedo.']))
    const r = await crear([herramienta]).enviar({ texto: 'x' }, recolector().m)
    expect(r.motivo).toBe('completo')
    const segunda = recibidas[1].cuerpo['messages'] as Array<Record<string, any>>
    expect(segunda[3]['content']).toMatch(/No existe la herramienta/)
  })

  it('un servicio que no manda el id de la llamada: se le pone uno y se contesta con él', async () => {
    const { herramienta, ejecutadas } = eco()
    respuestas.push(flujo([], [{ id: '', nombre: 'eco', argumentos: '{"texto":"sin id"}' }]), flujo(['Ok.']))
    await crear([herramienta]).enviar({ texto: 'x' }, recolector().m)
    expect(ejecutadas).toEqual(['sin id'])
    const segunda = recibidas[1].cuerpo['messages'] as Array<Record<string, any>>
    expect(segunda[2]['tool_calls'][0]['id']).toBe(segunda[3]['tool_call_id'])
    expect(segunda[3]['tool_call_id']).toMatch(/\S+/)
  })

  it('si el usuario no permite una acción, el modelo recibe la negativa', async () => {
    const { herramienta, ejecutadas } = eco({ nivel: 'confirmar' })
    respuestas.push(flujo([], [usaEco('enviar')]), flujo(['Entendido.']))
    const { m, acciones } = recolector(async () => false)
    await crear([herramienta]).enviar({ texto: 'x' }, m)
    expect(ejecutadas).toEqual([])
    expect(acciones.map((a) => a.estado)).toEqual(['en_curso', 'denegada'])
    const segunda = recibidas[1].cuerpo['messages'] as Array<Record<string, any>>
    expect(segunda[3]['content']).toMatch(/no permitió/)
  })

  it('límite de pasos: ejecuta solo los permitidos y pide un resumen con tool_choice «none»', async () => {
    const { herramienta, ejecutadas } = eco()
    respuestas.push(flujo([], [usaEco('uno', 'c1')]), flujo([], [usaEco('dos', 'c2')]), flujo(['Resumen.']))
    const { m, textos } = recolector()
    const r = await crear([herramienta], {}, 1).enviar({ texto: 'x' }, m)
    expect(r.motivo).toBe('limite_pasos')
    expect(ejecutadas).toEqual(['uno'])
    expect(textos).toContain('Resumen.')
    expect(recibidas[2].cuerpo['tool_choice']).toBe('none')
    const tercera = recibidas[2].cuerpo['messages'] as Array<Record<string, any>>
    expect(tercera[tercera.length - 1]).toMatchObject({ role: 'tool', tool_call_id: 'c2' })
    expect(tercera[tercera.length - 1]['content']).toMatch(/límite de pasos/)
  })

  it('una respuesta cortada por longitud con una herramienta a medias no la ejecuta ni la deja en el historial', async () => {
    const { herramienta, ejecutadas } = eco()
    respuestas.push(flujo(['abc'], [usaEco('x')], 'length'), flujo(['Sigo.']))
    const p = crear([herramienta])
    expect((await p.enviar({ texto: 'Largo' }, recolector().m)).motivo).toBe('limite_tokens')
    expect(ejecutadas).toEqual([])
    await p.enviar({ texto: 'Continúa' }, recolector().m)
    const segunda = recibidas[1].cuerpo['messages'] as Array<Record<string, any>>
    expect(roles(segunda)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(segunda[2]['tool_calls']).toBeUndefined()
  })

  it('los resultados largos de rondas antiguas se recortan; los recientes se conservan', async () => {
    const largo = 'x'.repeat(2000)
    const { herramienta } = eco({ ejecutar: async () => ({ texto: largo }) })
    for (let i = 1; i <= 6; i++) respuestas.push(flujo([], [usaEco(`n${i}`, `c${i}`)]))
    respuestas.push(flujo(['Fin.']))
    await crear([herramienta]).enviar({ texto: 'muchas veces' }, recolector().m)
    const ultima = recibidas[6].cuerpo['messages'] as Array<Record<string, any>>
    const resultados = ultima.filter((m) => m['role'] === 'tool').map((m) => m['content'] as string)
    expect(resultados).toHaveLength(6)
    expect(resultados.slice(0, 2).every((c) => c.startsWith('[Resultado anterior omitido'))).toBe(true)
    expect(resultados.slice(2).every((c) => c === largo)).toBe(true)
  })

  it('la captura de pantalla solo viaja en la primera petición; el historial guarda el texto', async () => {
    const { herramienta } = eco()
    respuestas.push(flujo([], [usaEco('x')]), flujo(['Visto.']))
    const imagen = { tipoMime: 'image/png' as const, base64: 'AAAA', ancho: 1, alto: 1 }
    await crear([herramienta]).enviar({ texto: '¿Qué ves?', contexto: { imagen } }, recolector().m)
    const primera = recibidas[0].cuerpo['messages'] as Array<Record<string, any>>
    const segunda = recibidas[1].cuerpo['messages'] as Array<Record<string, any>>
    expect(Array.isArray(primera[1]['content'])).toBe(true)
    expect(typeof segunda[1]['content']).toBe('string')
  })
})

describe('ProveedorOpenai como agente: Detener', () => {
  it('detener en mitad de una herramienta corta al instante y deja el historial válido', async () => {
    let iniciada = false
    const { herramienta } = eco({
      ejecutar: async () => {
        iniciada = true
        return nuncaTermina()
      }
    })
    respuestas.push(flujo([], [usaEco('colgada', 'c_colgada')]))
    const p = crear([herramienta])
    const { m, acciones } = recolector()
    const turno = p.enviar({ texto: 'Haz algo largo' }, m)
    await esperarHasta(() => iniciada)
    p.cancelar()
    expect((await turno).motivo).toBe('cancelado')
    expect(acciones.map((a) => a.estado)).toEqual(['en_curso', 'cancelada'])

    respuestas.push(flujo(['Aquí estoy.']))
    await p.enviar({ texto: 'Sigamos' }, recolector().m)
    const mensajes = recibidas[1].cuerpo['messages'] as Array<Record<string, any>>
    expect(roles(mensajes)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user'])
    expect(mensajes[3]).toEqual({ role: 'tool', tool_call_id: 'c_colgada', content: 'Cancelado por el usuario.' })
    expect(mensajes[4]['content']).toBe(MARCA_DETENIDO)
  })

  it('detener mientras el modelo escribe también deja el historial válido', async () => {
    const { herramienta } = eco()
    respuestas.push(respuestaColgada)
    const p = crear([herramienta])
    const { m, textos } = recolector()
    const turno = p.enviar({ texto: 'Cuéntame' }, m)
    await esperarHasta(() => textos.length > 0)
    p.cancelar()
    expect((await turno).motivo).toBe('cancelado')

    respuestas.push(flujo(['Dime.']))
    await p.enviar({ texto: 'Perdona' }, recolector().m)
    const mensajes = recibidas[1].cuerpo['messages'] as Array<Record<string, any>>
    expect(roles(mensajes)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(mensajes[2]['content']).toBe(MARCA_DETENIDO)
  })
})

describe('ProveedorOpenai como agente: errores y funciones puras', () => {
  const rechazo = (mensaje: string, estado = 400): Respuesta => (res) => {
    res.writeHead(estado, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: mensaje } }))
  }

  it('un servicio que no admite herramientas: se sigue conversando sin ellas, se avisa y las conversaciones siguientes ya no las mandan', async () => {
    const { herramienta } = eco()
    respuestas.push(rechazo('This model does not support tools'), flujo(['Hola, sin herramientas.']), flujo(['Otra vez.']))
    const p = crear([herramienta])
    const avisos: string[] = []
    const textos: string[] = []
    const r = await p.enviar({ texto: 'Hola' }, { alTexto: (d) => textos.push(d), alAviso: (t) => avisos.push(t) })

    expect(r.motivo).toBe('completo')
    expect(textos).toEqual(['Hola, sin herramientas.'])
    expect(avisos).toEqual(['Este modelo o servicio no admite herramientas: sigo solo conversando, sin buscar ni abrir nada.'])
    expect(recibidas).toHaveLength(2)
    expect(recibidas[0].cuerpo['tools']).toBeDefined()
    expect(recibidas[1].cuerpo['tools']).toBeUndefined()
    expect(recibidas[1].cuerpo['tool_choice']).toBeUndefined()

    // La siguiente conversación ni lo intenta, y vuelve el prompt de solo conversar.
    p.reiniciar()
    await p.enviar({ texto: 'Hola otra vez' }, recolector().m)
    expect(recibidas).toHaveLength(3)
    expect(recibidas[2].cuerpo['tools']).toBeUndefined()
    expect(String(recibidas[2].cuerpo['messages'][0].content)).toContain('Solo conversas')
  })

  it('también cuando el servicio contesta 422 o lo dice de otra manera', async () => {
    const { herramienta } = eco()
    for (const [estado, mensaje] of [
      [422, 'Unrecognized request argument supplied: tools'],
      [400, 'Function calling is not supported by this model'],
      [400, "'tool_choice' is only allowed when 'tools' are specified"]
    ] as const) {
      recibidas = []
      respuestas.push(rechazo(mensaje, estado), flujo(['Vale.']))
      expect((await crear([herramienta]).enviar({ texto: 'x' }, recolector().m)).motivo).toBe('completo')
      expect(recibidas[1].cuerpo['tools']).toBeUndefined()
    }
  })

  it('si el servicio rechaza algo que no son las herramientas, no se reintenta y el error sale tal cual', async () => {
    const { herramienta } = eco()
    respuestas.push(rechazo('Invalid API key format'), flujo(['no debería llegar']))
    await expect(crear([herramienta]).enviar({ texto: 'x' }, recolector().m)).rejects.toBeInstanceOf(ErrorChat)
    expect(recibidas).toHaveLength(1)
  })

  it('si sigue rechazando incluso sin herramientas, el error dice cómo apagar el modo agente', async () => {
    const { herramienta } = eco()
    respuestas.push(rechazo('This model does not support tools'), rechazo('This model does not support tools'))
    try {
      await crear([herramienta]).enviar({ texto: 'x' }, recolector().m)
      throw new Error('debía fallar')
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorChat)
      expect((e as ErrorChat).error.mensaje).toMatch(/no admite herramientas.*ORBE_AGENTE=0/)
    }
    expect(errorDesdeHttp(400, JSON.stringify({ error: { message: 'tools unsupported' } })).error.codigo).toBe('solicitud_invalida')
  })

  it('si el servicio rechaza el nivel de potencia pero admite herramientas, se quita solo el nivel', async () => {
    const { herramienta } = eco()
    respuestas.push(rechazo("Unsupported parameter: 'reasoning_effort'"), flujo(['Vale.']))
    const p = crear([herramienta])
    p.establecerEsfuerzo('max')
    const avisos: string[] = []
    await p.enviar({ texto: 'x' }, { alTexto: () => {}, alAviso: (t) => avisos.push(t) })
    expect(recibidas[0].cuerpo['reasoning_effort']).toBe('high')
    expect(recibidas[1].cuerpo['reasoning_effort']).toBeUndefined()
    expect(recibidas[1].cuerpo['tools']).toBeDefined()
    expect(avisos).toEqual(['Este servicio no admite niveles de potencia: sigo con el nivel normal del modelo.'])
  })

  it('si el rechazo habla de herramientas, se quitan ellas y no se culpa al nivel de potencia', async () => {
    const { herramienta } = eco()
    respuestas.push(rechazo('Unrecognized request argument supplied: tools'), flujo(['Vale.']))
    const p = crear([herramienta])
    p.establecerEsfuerzo('max')
    const avisos: string[] = []
    await p.enviar({ texto: 'x' }, { alTexto: () => {}, alAviso: (t) => avisos.push(t) })
    expect(recibidas[1].cuerpo['tools']).toBeUndefined()
    expect(recibidas[1].cuerpo['reasoning_effort']).toBe('high')
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatch(/no admite herramientas/)
  })

  it('repararHistorialCancelado contesta las llamadas pendientes y cierra con la marca', () => {
    const mensajes: any[] = [
      { role: 'user', content: 'hola' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'a', type: 'function', function: { name: 'eco', arguments: '{}' } },
          { id: 'b', type: 'function', function: { name: 'eco', arguments: '{}' } }
        ]
      }
    ]
    repararHistorialCancelado(mensajes, [{ id: 'a', contenido: 'listo', esError: false }])
    expect(mensajes.slice(2)).toEqual([
      { role: 'tool', tool_call_id: 'a', content: 'listo' },
      { role: 'tool', tool_call_id: 'b', content: 'Cancelado por el usuario.' },
      { role: 'assistant', content: MARCA_DETENIDO }
    ])
  })

  it('compactarResultadosAntiguos conserva los últimos cuatro y lo corto', () => {
    const tool = (id: string, content: string): any => ({ role: 'tool', tool_call_id: id, content })
    const mensajes: any[] = [tool('1', 'x'.repeat(3000)), tool('2', 'corto'), tool('3', 'x'.repeat(3000)), tool('4', 'x'.repeat(3000)), tool('5', 'x'.repeat(3000)), tool('6', 'x'.repeat(3000))]
    compactarResultadosAntiguos(mensajes)
    expect(mensajes[0].content).toMatch(/omitido/)
    expect(mensajes[1].content).toBe('corto')
    expect(mensajes[2].content).toHaveLength(3000)
  })
})

describe('ProveedorOpenai con buscar_web', () => {
  const resultados = [
    { titulo: 'El tiempo en Lima', url: 'https://www.ejemplo.org/lima', extracto: 'Nublado, 19 °C.' },
    { titulo: 'Previsión', url: 'https://clima.example.com/', extracto: '' }
  ]

  function conBuscador(): { proveedor: ProveedorOpenai; consultas: string[] } {
    const consultas: string[] = []
    const buscador: ProveedorBusqueda = {
      nombre: 'tavily',
      buscar: async (consulta) => {
        consultas.push(consulta)
        return resultados
      }
    }
    return { proveedor: crear([crearBuscarWeb(buscador)]), consultas }
  }

  it('el modelo busca, recibe los resultados como datos externos y las fuentes salen como enlaces', async () => {
    respuestas.push(
      flujo(['Voy a buscarlo.'], [{ id: 'call_1', nombre: 'buscar_web', argumentos: JSON.stringify({ consulta: 'tiempo en Lima' }) }]),
      flujo(['En Lima hay 19 °C.'])
    )
    const { proveedor, consultas } = conBuscador()
    const textos: string[] = []
    const acciones: AccionVista[] = []
    const fuentes: FuenteVista[][] = []
    const r = await proveedor.enviar({ texto: '¿Qué tiempo hace en Lima?' }, { alTexto: (d) => textos.push(d), alAccion: (a) => acciones.push(a), alFuentes: (f) => fuentes.push(f) })

    expect(r.motivo).toBe('completo')
    expect(consultas).toEqual(['tiempo en Lima'])
    expect(acciones.map((a) => [a.estado, a.titulo])).toEqual([
      ['en_curso', 'Buscando: tiempo en Lima'],
      ['ok', 'Buscando: tiempo en Lima']
    ])
    expect(fuentes).toEqual([resultados.map((x) => ({ titulo: x.titulo, url: x.url }))])

    const peticion = recibidas[0].cuerpo
    expect(peticion['tools'].map((t: any) => t.function.name)).toEqual(['buscar_web'])
    expect(String(peticion['messages'][0].content)).toContain('Puedes buscar en internet')

    const segunda = recibidas[1].cuerpo['messages'] as Array<{ role: string; content: string }>
    const herramienta = segunda.find((m) => m.role === 'tool')
    expect(herramienta?.content).toMatch(/^<contenido_externo origen="busqueda" id="[0-9a-f]{12}">/)
    expect(herramienta?.content).toContain('https://www.ejemplo.org/lima')
  })
})
