import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserWindow } from 'electron'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANALES, NIVELES_ESFUERZO, type InfoPotencia, type NivelEsfuerzo } from '../src/shared/tipos'
import type { ManejadoresTurno, ProveedorChat } from '../src/main/chat/proveedor'
import { ProveedorApi } from '../src/main/chat/proveedor-api'
import { ProveedorCli } from '../src/main/chat/proveedor-cli'
import { ProveedorOpenai, esfuerzoParaServicio } from '../src/main/chat/proveedor-openai'
import { DESCRIPCION_NIVEL, NOMBRE_NIVEL } from '../src/shared/potencia'

const electron = vi.hoisted(() => ({
  manejadores: new Map<string, (...args: unknown[]) => unknown>()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, fn: (...args: unknown[]) => unknown) => electron.manejadores.set(canal, fn),
    on: () => undefined
  },
  BrowserWindow: class {}
}))
const { esNivelEsfuerzo, nivelInicial, registrarPotencia } = await import('../src/main/potencia')

// ---------------------------------------------------------------------------------------------
// El IPC del marcador
// ---------------------------------------------------------------------------------------------

function montar(proveedor: Partial<ProveedorChat> = { aplicaEsfuerzo: 'ahora', establecerEsfuerzo: vi.fn() }, nivel: NivelEsfuerzo = 'medium') {
  electron.manejadores.clear()
  const webContents = {}
  const ventana = { webContents } as unknown as BrowserWindow
  const guardar = vi.fn()
  registrarPotencia({ ventana, proveedor: proveedor as ProveedorChat, nivel, guardar })
  const invocar = (canal: string, propio: boolean, ...args: unknown[]): unknown =>
    (electron.manejadores.get(canal) as (...a: unknown[]) => unknown)({ sender: propio ? webContents : {} }, ...args)
  return { guardar, invocar, proveedor }
}

describe('nivelInicial y esNivelEsfuerzo', () => {
  it('reconoce los cinco niveles y nada más', () => {
    for (const n of NIVELES_ESFUERZO) expect(esNivelEsfuerzo(n)).toBe(true)
    for (const raro of ['', 'alto', 'LOW', 5, null, undefined, {}, ['low']]) expect(esNivelEsfuerzo(raro)).toBe(false)
  })

  it('vale el que dejó el usuario; si es inválido o no hay, el de la configuración', () => {
    expect(nivelInicial('high', 'medium')).toBe('high')
    expect(nivelInicial(undefined, 'xhigh')).toBe('xhigh')
    expect(nivelInicial('muchísimo', 'low')).toBe('low')
    expect(nivelInicial(3, 'max')).toBe('max')
  })
})

describe('registrarPotencia', () => {
  it('al arrancar le da al proveedor el nivel inicial', () => {
    const establecerEsfuerzo = vi.fn()
    montar({ aplicaEsfuerzo: 'ahora', establecerEsfuerzo }, 'high')
    expect(establecerEsfuerzo).toHaveBeenCalledWith('high')
  })

  it('informa del nivel y de cuándo se aplica un cambio con ese proveedor', () => {
    expect(montar({ aplicaEsfuerzo: 'proxima_conversacion', establecerEsfuerzo: vi.fn() }, 'low').invocar(CANALES.potenciaInfo, true)).toEqual({
      nivel: 'low',
      aplica: 'proxima_conversacion'
    } satisfies InfoPotencia)
    // Un proveedor sin esa información se trata con cautela.
    expect(montar({}).invocar(CANALES.potenciaInfo, true)).toEqual({ nivel: 'medium', aplica: 'segun_servicio' })
  })

  it('al moverlo cambia el proveedor, se guarda para la próxima vez y devuelve la información nueva', () => {
    const establecerEsfuerzo = vi.fn()
    const t = montar({ aplicaEsfuerzo: 'ahora', establecerEsfuerzo })
    const r = t.invocar(CANALES.potenciaFijar, true, 'max')
    expect(r).toEqual({ nivel: 'max', aplica: 'ahora' })
    expect(establecerEsfuerzo).toHaveBeenLastCalledWith('max')
    expect(t.guardar).toHaveBeenCalledWith('max')
    expect(t.invocar(CANALES.potenciaInfo, true)).toEqual({ nivel: 'max', aplica: 'ahora' })
  })

  it('un nivel que no existe no cambia nada', () => {
    const establecerEsfuerzo = vi.fn()
    const t = montar({ aplicaEsfuerzo: 'ahora', establecerEsfuerzo }, 'high')
    for (const raro of ['turbo', 7, null, undefined, { nivel: 'low' }]) {
      expect(t.invocar(CANALES.potenciaFijar, true, raro)).toEqual({ nivel: 'high', aplica: 'ahora' })
    }
    expect(t.guardar).not.toHaveBeenCalled()
    expect(establecerEsfuerzo).toHaveBeenCalledTimes(1) // solo la del arranque
  })

  it('solo atiende a la ventana de Orbe', () => {
    const t = montar()
    expect(() => t.invocar(CANALES.potenciaInfo, false)).toThrow(/no autorizado/i)
    expect(() => t.invocar(CANALES.potenciaFijar, false, 'low')).toThrow(/no autorizado/i)
    expect(t.guardar).not.toHaveBeenCalled()
  })
})

describe('los textos del marcador', () => {
  it('cada nivel tiene su nombre y su explicación', () => {
    for (const n of NIVELES_ESFUERZO) {
      expect(NOMBRE_NIVEL[n]).toMatch(/\S/)
      expect(DESCRIPCION_NIVEL[n]).toMatch(/\S/)
    }
    expect(NOMBRE_NIVEL.low).toBe('Rápido')
    expect(NOMBRE_NIVEL.max).toBe('Máximo')
  })
})

// ---------------------------------------------------------------------------------------------
// Servidor de mentira (Anthropic y chat completions)
// ---------------------------------------------------------------------------------------------

type Respuesta = (res: ServerResponse) => void | Promise<void>
let servidor: Server
let puerto: number
let recibidas: Array<Record<string, any>>
let respuestas: Respuesta[]

function evento(res: ServerResponse, nombre: string, datos: unknown): void {
  res.write(`event: ${nombre}\ndata: ${JSON.stringify(datos)}\n\n`)
}
const respuestaAnthropic: Respuesta = (res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  evento(res, 'message_start', {
    type: 'message_start',
    message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
  })
  evento(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  evento(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })
  evento(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  evento(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
  evento(res, 'message_stop', { type: 'message_stop' })
  res.end()
}
const respuestaOpenai: Respuesta = (res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: null }] })}\n\n`)
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}
const errorOpenai = (estado: number, mensaje: string): Respuesta => (res) => {
  res.writeHead(estado, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: mensaje } }))
}

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const partes: Buffer[] = []
    req.on('data', (t) => partes.push(t))
    req.on('end', () => {
      recibidas.push(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}'))
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
})

const manejadores = (avisos: string[] = []): ManejadoresTurno => ({ alTexto: () => undefined, alAviso: (t) => avisos.push(t) })

// ---------------------------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------------------------

describe('el marcador y la API de Claude', () => {
  const crear = (esfuerzo: NivelEsfuerzo): ProveedorApi =>
    new ProveedorApi({ apiKey: 'k', modelo: 'claude-sonnet-5-5', esfuerzo, baseURL: `http://127.0.0.1:${puerto}`, maxRetries: 0, timeoutMs: 5000 })

  it('el cambio se nota en el siguiente mensaje, sin reiniciar nada', async () => {
    const p = crear('medium')
    expect(p.aplicaEsfuerzo).toBe('ahora')
    respuestas.push(respuestaAnthropic, respuestaAnthropic, respuestaAnthropic)
    await p.enviar({ texto: 'uno' }, manejadores())
    p.establecerEsfuerzo('max')
    await p.enviar({ texto: 'dos' }, manejadores())
    p.establecerEsfuerzo('low')
    await p.enviar({ texto: 'tres' }, manejadores())
    expect(recibidas.map((r) => r['output_config'])).toEqual([{ effort: 'medium' }, { effort: 'max' }, { effort: 'low' }])
    p.cerrar()
  })
})

describe('el marcador y el CLI de Claude', () => {
  const FALSO = join(dirname(fileURLToPath(import.meta.url)), 'falso-claude.mjs')
  it('el nivel va como --effort al arrancar el proceso: el cambio se nota en la conversación siguiente', async () => {
    const lanzamientos: Array<{ args: string[]; hijo: ChildProcess }> = []
    const p = new ProveedorCli({
      modelo: 'claude-sonnet-5-5',
      esfuerzo: 'medium',
      directorioTrabajo: mkdtempSync(join(tmpdir(), 'orbe-cli-')),
      lanzador: (args, { cwd, env }) => {
        const hijo = spawn(process.execPath, [FALSO, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
        lanzamientos.push({ args, hijo })
        return hijo
      }
    })
    expect(p.aplicaEsfuerzo).toBe('proxima_conversacion')
    const nivelDe = (i: number): string => lanzamientos[i].args[lanzamientos[i].args.indexOf('--effort') + 1]

    await p.enviar({ texto: 'hola' }, manejadores())
    expect(nivelDe(0)).toBe('medium')
    p.establecerEsfuerzo('xhigh')
    await p.enviar({ texto: 'otra vez' }, manejadores())
    expect(lanzamientos).toHaveLength(1) // el proceso de la conversación sigue: no se pierde el contexto
    p.reiniciar()
    await p.enviar({ texto: 'conversación nueva' }, manejadores())
    expect(lanzamientos).toHaveLength(2)
    expect(nivelDe(1)).toBe('xhigh')
    p.cerrar()
  })
})

describe('el marcador y un servicio compatible con OpenAI', () => {
  const crear = (): ProveedorOpenai => new ProveedorOpenai({ url: `http://127.0.0.1:${puerto}/v1`, clave: 'k', modelo: 'modelo-x' })

  it('los cinco niveles se reparten en los tres que entienden esos servicios', () => {
    expect(NIVELES_ESFUERZO.map(esfuerzoParaServicio)).toEqual(['low', 'medium', 'high', 'high', 'high'])
  })

  it('en el punto medio no manda nada: el servicio se comporta como siempre', async () => {
    const p = crear()
    expect(p.aplicaEsfuerzo).toBe('segun_servicio')
    respuestas.push(respuestaOpenai)
    await p.enviar({ texto: 'hola' }, manejadores())
    expect(recibidas[0]['reasoning_effort']).toBeUndefined()
  })

  it('movido del punto medio manda reasoning_effort con el nivel traducido', async () => {
    const p = crear()
    respuestas.push(respuestaOpenai, respuestaOpenai)
    p.establecerEsfuerzo('max')
    await p.enviar({ texto: 'uno' }, manejadores())
    p.establecerEsfuerzo('low')
    await p.enviar({ texto: 'dos' }, manejadores())
    expect(recibidas.map((r) => r['reasoning_effort'])).toEqual(['high', 'low'])
  })

  it('si el servicio lo rechaza, repite sin él, avisa y no se lo vuelve a mandar', async () => {
    const p = crear()
    const avisos: string[] = []
    respuestas.push(errorOpenai(400, 'Unrecognized request argument supplied: reasoning_effort'), respuestaOpenai, respuestaOpenai)
    p.establecerEsfuerzo('high')
    const r = await p.enviar({ texto: 'uno' }, manejadores(avisos))
    expect(r.motivo).toBe('completo')
    expect(recibidas.map((x) => x['reasoning_effort'])).toEqual(['high', undefined])
    expect(avisos).toEqual([expect.stringMatching(/no admite niveles de potencia/)])
    await p.enviar({ texto: 'dos' }, manejadores(avisos))
    expect(recibidas[2]['reasoning_effort']).toBeUndefined()
    expect(avisos).toHaveLength(1)
  })

  it('al mover el marcador otra vez se le da otra oportunidad al servicio', async () => {
    const p = crear()
    respuestas.push(errorOpenai(400, 'unknown parameter: reasoning_effort'), respuestaOpenai, respuestaOpenai)
    p.establecerEsfuerzo('high')
    await p.enviar({ texto: 'uno' }, manejadores())
    p.establecerEsfuerzo('low')
    await p.enviar({ texto: 'dos' }, manejadores())
    expect(recibidas[2]['reasoning_effort']).toBe('low')
  })

  it('un 400 que no habla de parámetros sigue siendo el error de siempre (y no se reintenta)', async () => {
    const p = crear()
    respuestas.push(errorOpenai(400, 'The model `modelo-x` does not exist'))
    p.establecerEsfuerzo('high')
    await expect(p.enviar({ texto: 'uno' }, manejadores())).rejects.toMatchObject({ error: { codigo: 'modelo' } })
    expect(recibidas).toHaveLength(1)
  })
})
