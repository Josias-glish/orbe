import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CANALES, type EventoChat, type EventoPantalla, type InfoChat } from '../src/shared/tipos'
import type { TurnoEntrada } from '../src/main/chat/contenido'
import { ErrorChat, crearError } from '../src/main/chat/errores'
import type { ManejadoresTurno, ProveedorChat, ResultadoTurno } from '../src/main/chat/proveedor'
import type { ResultadoLectura } from '../src/main/pantalla/contexto'
import { ContextoPendiente } from '../src/main/pantalla/pendiente'

type Manejador = (evento: unknown, ...args: unknown[]) => unknown

const electron = vi.hoisted(() => ({
  manejadores: new Map<string, (...args: unknown[]) => unknown>(),
  escuchas: new Map<string, (...args: unknown[]) => unknown>(),
  openExternal: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, fn: (...args: unknown[]) => unknown) => electron.manejadores.set(canal, fn),
    on: (canal: string, fn: (...args: unknown[]) => unknown) => electron.escuchas.set(canal, fn)
  },
  shell: { openExternal: electron.openExternal },
  BrowserWindow: class {}
}))

const { registrarChat } = await import('../src/main/chat/ipc')

const INFO: InfoChat = { proveedor: 'cli', modelo: 'claude-sonnet-5-5', modeloLegible: 'Sonnet 5.5' }

/** Un proveedor que se queda esperando hasta que la prueba lo termine o lo haga fallar. */
class ProveedorControlado implements ProveedorChat {
  readonly nombre = 'cli' as const
  readonly modelo = 'prueba'
  turnos: TurnoEntrada[] = []
  private fin: { ok: (r: ResultadoTurno) => void; ko: (e: unknown) => void } | null = null

  enviar(turno: TurnoEntrada, _m: ManejadoresTurno): Promise<ResultadoTurno> {
    this.turnos.push(turno)
    return new Promise((ok, ko) => (this.fin = { ok, ko }))
  }
  terminar(): void {
    this.fin?.ok({ motivo: 'completo' })
  }
  fallar(e: unknown): void {
    this.fin?.ko(e)
  }
  cancelar(): void {}
  reiniciar(): void {}
  cerrar(): void {}
}

function lectura(): ResultadoLectura {
  return {
    contexto: { ventana: { aplicacion: 'Edge', titulo: 'Receta' }, contenido: 'tortilla de patatas' },
    lectura: {
      partes: [
        { clave: 'ventana', etiqueta: 'Ventana', resumen: 'Edge — Receta', vista: 'Aplicación: Edge' },
        { clave: 'contenido', etiqueta: 'Contenido', resumen: '19 caracteres', vista: 'tortilla de patatas', caracteres: 19 }
      ],
      avisos: [],
      sugerirCaptura: false
    }
  }
}

const esperar = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))

function montar(conReserva = true) {
  electron.manejadores.clear()
  electron.escuchas.clear()
  const enviados: Array<{ canal: string; evento: unknown }> = []
  const webContents = { send: (canal: string, evento: unknown) => enviados.push({ canal, evento }) }
  const ventana = { webContents, isDestroyed: () => false } as unknown as BrowserWindow
  const proveedor = new ProveedorControlado()
  const pendiente = new ContextoPendiente(() => undefined)
  const emitidos: EventoPantalla[] = []
  registrarChat(
    ventana,
    proveedor,
    INFO,
    conReserva
      ? {
          consumir: () => pendiente.consumir(),
          restaurar: (c) => pendiente.restaurar(c),
          emitir: (e) => emitidos.push(e)
        }
      : undefined
  )
  const invocar = (canal: string, propio: boolean, ...args: unknown[]): unknown =>
    (electron.manejadores.get(canal) as Manejador)({ sender: propio ? webContents : {} }, ...args)
  const eventosChat = (): EventoChat[] => enviados.filter((e) => e.canal === CANALES.chatEvento).map((e) => e.evento as EventoChat)
  return {
    proveedor,
    pendiente,
    emitidos,
    eventosChat,
    enviar: (peticion: unknown, propio = true) => invocar(CANALES.chatEnviar, propio, peticion) as Record<string, unknown>,
    invocar,
    emitirDesde: (canal: string, propio: boolean, ...args: unknown[]) =>
      (electron.escuchas.get(canal) as Manejador)({ sender: propio ? webContents : {} }, ...args)
  }
}

beforeEach(() => electron.openExternal.mockClear())

describe('chat:enviar y el contexto de pantalla', () => {
  it('con contexto pedido y pendiente: se adjunta, se vacía la reserva y la interfaz se entera', async () => {
    const t = montar()
    t.pendiente.establecer(lectura())
    const r = t.enviar({ id: 'a', texto: '¿Qué es esto?', conContexto: true })
    expect(r).toMatchObject({ ok: true })
    expect((r['adjuntos'] as Array<{ clave: string }>).map((p) => p.clave)).toEqual(['ventana', 'contenido'])
    expect(t.pendiente.hay()).toBe(false)
    expect(t.emitidos).toEqual([{ tipo: 'vacio', motivo: 'enviado' }])
    await esperar()
    expect(t.proveedor.turnos[0].contexto).toEqual({ ventana: { aplicacion: 'Edge', titulo: 'Receta' }, contenido: 'tortilla de patatas' })
    expect(t.proveedor.turnos[0].texto).toBe('¿Qué es esto?')
  })

  it('sin pedirlo no viaja nada, aunque haya algo leído: sigue esperando al usuario', async () => {
    const t = montar()
    t.pendiente.establecer(lectura())
    const r = t.enviar({ id: 'a', texto: 'Hola' })
    expect(r).toEqual({ ok: true, adjuntos: [] })
    await esperar()
    expect(t.proveedor.turnos[0].contexto).toBeUndefined()
    expect(t.pendiente.hay()).toBe(true)
    expect(t.emitidos).toEqual([])
  })

  it.each([['true'], [1], ['si'], [{}], [null], [false]])('conContexto=%j no cuenta como un sí', async (valor) => {
    const t = montar()
    t.pendiente.establecer(lectura())
    t.enviar({ id: 'a', texto: 'Hola', conContexto: valor })
    await esperar()
    expect(t.proveedor.turnos[0].contexto).toBeUndefined()
    expect(t.pendiente.hay()).toBe(true)
  })

  it('pidiendo contexto cuando no hay nada leído, el mensaje sale limpio', async () => {
    const t = montar()
    const r = t.enviar({ id: 'a', texto: 'Hola', conContexto: true })
    expect(r).toEqual({ ok: true, adjuntos: [] })
    await esperar()
    expect(t.proveedor.turnos[0].contexto).toBeUndefined()
  })

  it('sin reserva configurada (modo sin lector) también funciona', async () => {
    const t = montar(false)
    expect(t.enviar({ id: 'a', texto: 'Hola', conContexto: true })).toEqual({ ok: true, adjuntos: [] })
  })

  it('si el envío falla, el contexto vuelve a la reserva para reintentar sin leer otra vez', async () => {
    const t = montar()
    t.pendiente.establecer(lectura())
    t.enviar({ id: 'a', texto: 'Hola', conContexto: true })
    expect(t.pendiente.hay()).toBe(false)

    t.proveedor.fallar(new ErrorChat(crearError('sin_conexion')))
    await esperar()

    expect(t.eventosChat().at(-1)).toMatchObject({ tipo: 'error', id: 'a' })
    expect(t.pendiente.hay()).toBe(true)
    const restaurado = t.emitidos.find((e) => e.tipo === 'pendiente')
    expect(restaurado).toMatchObject({ tipo: 'pendiente', origen: 'restaurado' })
    expect((restaurado as { lectura: { partes: unknown[] } }).lectura.partes).toHaveLength(2)

    // Al reintentar se vuelve a adjuntar.
    const r = t.enviar({ id: 'b', texto: 'Hola', conContexto: true })
    expect((r['adjuntos'] as unknown[]).length).toBe(2)
  })

  it('si el turno termina bien, el contexto no vuelve (ya se usó)', async () => {
    const t = montar()
    t.pendiente.establecer(lectura())
    t.enviar({ id: 'a', texto: 'Hola', conContexto: true })
    t.proveedor.terminar()
    await esperar()
    expect(t.eventosChat().at(-1)).toMatchObject({ tipo: 'fin', id: 'a' })
    expect(t.pendiente.hay()).toBe(false)
    expect(t.emitidos.filter((e) => e.tipo === 'pendiente')).toEqual([])
  })

  it('si el fallo es de otro turno (sin contexto), no se toca la reserva', async () => {
    const t = montar()
    t.enviar({ id: 'a', texto: 'Hola' })
    t.pendiente.establecer(lectura()) // el usuario lee la pantalla mientras Claude responde
    t.proveedor.fallar(new ErrorChat(crearError('sin_conexion')))
    await esperar()
    expect(t.pendiente.hay()).toBe(true)
    expect(t.emitidos).toEqual([])
  })

  it('una petición inválida no gasta el contexto', () => {
    const t = montar()
    t.pendiente.establecer(lectura())
    const r = t.enviar({ id: 'a', texto: '   ', conContexto: true })
    expect(r).toMatchObject({ ok: false })
    expect(t.pendiente.hay()).toBe(true)
    expect(t.emitidos).toEqual([])
    expect(t.proveedor.turnos).toEqual([])
  })

  it('si ya hay una respuesta en curso, rechaza el segundo envío y conserva su contexto', async () => {
    const t = montar()
    t.enviar({ id: 'a', texto: 'Primero' })
    t.pendiente.establecer(lectura())
    const r = t.enviar({ id: 'b', texto: 'Segundo', conContexto: true })
    expect(r).toMatchObject({ ok: false })
    expect(t.pendiente.hay()).toBe(true)
    await esperar()
    expect(t.proveedor.turnos).toHaveLength(1)
  })

  it('un remitente que no es la ventana de Orbe no puede enviar ni gastar el contexto', () => {
    const t = montar()
    t.pendiente.establecer(lectura())
    expect(() => t.enviar({ id: 'a', texto: 'Hola', conContexto: true }, false)).toThrow(/no autorizado/i)
    expect(t.pendiente.hay()).toBe(true)
  })
})

describe('otros canales del chat', () => {
  it('chat:info solo responde a la ventana de Orbe', () => {
    const t = montar()
    expect(t.invocar(CANALES.chatInfo, true)).toEqual(INFO)
    expect(t.invocar(CANALES.chatInfo, false)).toBeNull()
  })

  it('abrir enlace: solo https/http y solo desde la ventana de Orbe', () => {
    const t = montar()
    t.emitirDesde(CANALES.abrirEnlace, true, 'https://example.com/a')
    t.emitirDesde(CANALES.abrirEnlace, true, 'file:///C:/Windows/System32/calc.exe')
    t.emitirDesde(CANALES.abrirEnlace, true, 'javascript:alert(1)')
    t.emitirDesde(CANALES.abrirEnlace, false, 'https://example.org/')
    expect(electron.openExternal).toHaveBeenCalledTimes(1)
    expect(electron.openExternal).toHaveBeenCalledWith('https://example.com/a')
  })
})
