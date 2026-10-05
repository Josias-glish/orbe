import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CANALES, type AccionVista, type EventoChat, type EventoPantalla, type InfoChat } from '../src/shared/tipos'
import type { PeticionConfirmacion } from '../src/main/agente/tipos'
import type { TurnoEntrada } from '../src/main/chat/contenido'
import { ErrorChat, crearError } from '../src/main/chat/errores'
import type { MemoriaChat } from '../src/main/chat/ipc'
import type { ManejadoresTurno, ProveedorChat, ResultadoTurno } from '../src/main/chat/proveedor'
import type { CapturaMemoria } from '../src/main/memoria/servicio'
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

const INFO: InfoChat = { proveedor: 'cli', modelo: 'claude-sonnet-5-5', modeloLegible: 'Sonnet 5.5', agente: false }

/** Un proveedor que se queda esperando hasta que la prueba lo termine o lo haga fallar. */
class ProveedorControlado implements ProveedorChat {
  readonly nombre = 'cli' as const
  readonly modelo = 'prueba'
  turnos: TurnoEntrada[] = []
  private fin: { ok: (r: ResultadoTurno) => void; ko: (e: unknown) => void } | null = null
  private manejadores: ManejadoresTurno | null = null

  enviar(turno: TurnoEntrada, m: ManejadoresTurno): Promise<ResultadoTurno> {
    this.turnos.push(turno)
    this.manejadores = m
    return new Promise((ok, ko) => (this.fin = { ok, ko }))
  }
  /** Simula que llega un trozo de la respuesta. */
  decir(delta: string): void {
    this.manejadores?.alTexto(delta)
  }
  /** Simula que el agente cuenta una acción. */
  accion(accion: AccionVista): void {
    this.manejadores?.alAccion?.(accion)
  }
  /** Simula que el agente pide permiso al usuario. */
  confirmar(peticion: PeticionConfirmacion): Promise<boolean> | undefined {
    return this.manejadores?.confirmar?.(peticion)
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

/** Una memoria de mentira que apunta lo que le piden. */
function memoriaFalsa(opciones: { captura?: CapturaMemoria | null; historial?: string | null } = {}) {
  const llamadas = { capturar: [] as string[], completados: [] as Array<[string, string]>, confirmados: 0, nuevas: 0 }
  const memoria: MemoriaChat = {
    capturar: (texto) => {
      llamadas.capturar.push(texto)
      return opciones.captura ?? null
    },
    tomarHistorialPrevio: () => opciones.historial ?? null,
    confirmarHistorialUsado: () => {
      llamadas.confirmados++
    },
    turnoCompletado: (usuario, asistente) => {
      llamadas.completados.push([usuario, asistente])
    },
    nuevaConversacion: () => {
      llamadas.nuevas++
    }
  }
  return { memoria, llamadas }
}

function montar(conReserva = true, memoria?: MemoriaChat) {
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
      : undefined,
    memoria
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

describe('chat:enviar y la memoria', () => {
  const GUARDADO: CapturaMemoria = {
    aviso: { tipo: 'guardado', id: 'nota-mi-dato', texto: 'Mi dato' },
    nota: 'Orbe ha guardado esta nota en la memoria del usuario: «Mi dato».'
  }

  it('una orden de «recuerda que…» se resuelve antes de enviar: el usuario ve el aviso y el modelo recibe la nota', async () => {
    const { memoria, llamadas } = memoriaFalsa({ captura: GUARDADO })
    const t = montar(true, memoria)
    const r = t.enviar({ id: 'a', texto: '  Recuerda que mi dato  ' })
    expect(r).toEqual({ ok: true, adjuntos: [], memoria: GUARDADO.aviso })
    expect(llamadas.capturar).toEqual(['Recuerda que mi dato']) // el texto ya validado y sin espacios
    await esperar()
    expect(t.proveedor.turnos[0].notaApp).toBe(GUARDADO.nota)
    expect(t.proveedor.turnos[0].texto).toBe('Recuerda que mi dato')
  })

  it('un mensaje normal no lleva aviso ni nota', async () => {
    const { memoria } = memoriaFalsa()
    const t = montar(true, memoria)
    expect(t.enviar({ id: 'a', texto: 'Hola' })).toEqual({ ok: true, adjuntos: [] })
    await esperar()
    expect(t.proveedor.turnos[0].notaApp).toBeUndefined()
    expect(t.proveedor.turnos[0].historialPrevio).toBeUndefined()
  })

  it('una petición inválida o con una respuesta en curso no llega a tocar la memoria', async () => {
    const { memoria, llamadas } = memoriaFalsa({ captura: GUARDADO })
    const t = montar(true, memoria)
    expect(t.enviar({ id: 'a', texto: '   ' })).toMatchObject({ ok: false })
    expect(llamadas.capturar).toEqual([])

    t.enviar({ id: 'b', texto: 'Primero' })
    expect(t.enviar({ id: 'c', texto: 'Recuerda que otra cosa' })).toMatchObject({ ok: false })
    expect(llamadas.capturar).toEqual(['Primero']) // la segunda nunca se evaluó
  })

  it('el primer mensaje tras reabrir Orbe lleva la conversación anterior, y se da por usada al terminar', async () => {
    const { memoria, llamadas } = memoriaFalsa({ historial: 'Usuario: hola\nOrbe: ¡hola!' })
    const t = montar(true, memoria)
    t.enviar({ id: 'a', texto: 'sigamos' })
    await esperar()
    expect(t.proveedor.turnos[0].historialPrevio).toBe('Usuario: hola\nOrbe: ¡hola!')
    expect(llamadas.confirmados).toBe(0) // todavía no: si el envío fallara, habría que repetirlo
    t.proveedor.terminar()
    await esperar()
    expect(llamadas.confirmados).toBe(1)
  })

  it('si el envío falla, la conversación anterior no se da por usada ni se guarda el intercambio', async () => {
    const { memoria, llamadas } = memoriaFalsa({ historial: 'Usuario: hola\nOrbe: ¡hola!' })
    const t = montar(true, memoria)
    t.enviar({ id: 'a', texto: 'sigamos' })
    t.proveedor.decir('respuesta a medias')
    t.proveedor.fallar(new ErrorChat(crearError('sin_conexion')))
    await esperar()
    expect(llamadas.confirmados).toBe(0)
    expect(llamadas.completados).toEqual([])
  })

  it('al terminar un turno se guarda lo que escribió el usuario y lo que respondió Orbe', async () => {
    const { memoria, llamadas } = memoriaFalsa()
    const t = montar(true, memoria)
    t.enviar({ id: 'a', texto: '  ¿Qué es un orbe?  ' })
    t.proveedor.decir('Una ')
    t.proveedor.decir('esfera.')
    t.proveedor.terminar()
    await esperar()
    expect(llamadas.completados).toEqual([['¿Qué es un orbe?', 'Una esfera.']])
  })

  it('«nueva conversación» se lo dice a la memoria y descarta el turno que estuviera en curso', async () => {
    const { memoria, llamadas } = memoriaFalsa()
    const t = montar(true, memoria)
    t.enviar({ id: 'a', texto: 'Hola' })
    t.proveedor.decir('respuesta')
    await t.invocar(CANALES.chatNueva, true)
    expect(llamadas.nuevas).toBe(1)
    t.proveedor.terminar()
    await esperar()
    expect(llamadas.completados).toEqual([]) // lo hablado antes de «nueva» no se guarda
  })

  it('«nueva conversación» de un remitente ajeno no borra nada', async () => {
    const { memoria, llamadas } = memoriaFalsa()
    const t = montar(true, memoria)
    await t.invocar(CANALES.chatNueva, false)
    expect(llamadas.nuevas).toBe(0)
  })
})

describe('el agente: acciones y confirmaciones por IPC', () => {
  const accion = (estado: AccionVista['estado'], resultado?: string): AccionVista => ({
    accionId: 'a1',
    herramienta: 'eco',
    titulo: 'Repitiendo: hola',
    parametros: '{"texto":"hola"}',
    estado,
    ...(resultado ? { resultado } : {})
  })

  it('las acciones llegan a la interfaz como eventos del turno', async () => {
    const t = montar()
    t.enviar({ id: 'a', texto: 'Haz algo' })
    await esperar()
    t.proveedor.accion(accion('en_curso'))
    t.proveedor.accion(accion('ok', 'hola'))
    expect(t.eventosChat().filter((e) => e.tipo === 'accion')).toEqual([
      { tipo: 'accion', id: 'a', accion: accion('en_curso') },
      { tipo: 'accion', id: 'a', accion: accion('ok', 'hola') }
    ])
  })

  it('la confirmación llega con un id propio y el «sí» del usuario la resuelve', async () => {
    const t = montar()
    t.enviar({ id: 'a', texto: 'Envía el formulario' })
    await esperar()
    const respuesta = t.proveedor.confirmar({ titulo: 'Enviar el formulario', detalle: 'Pulsará «Enviar» en example.com' })
    const pedida = t.eventosChat().find((e) => e.tipo === 'confirmar')
    expect(pedida).toMatchObject({ tipo: 'confirmar', id: 'a', confirmacion: { titulo: 'Enviar el formulario' } })
    const confirmacionId = (pedida as Extract<EventoChat, { tipo: 'confirmar' }>).confirmacion.confirmacionId
    expect(confirmacionId).toMatch(/\S+/)
    t.emitirDesde(CANALES.chatConfirmar, true, 'a', confirmacionId, true)
    await expect(respuesta).resolves.toBe(true)
  })

  it('cancelar la tarjeta devuelve «no»', async () => {
    const t = montar()
    t.enviar({ id: 'a', texto: 'x' })
    await esperar()
    const respuesta = t.proveedor.confirmar({ titulo: 'T', detalle: 'D' })
    const id = (t.eventosChat().find((e) => e.tipo === 'confirmar') as Extract<EventoChat, { tipo: 'confirmar' }>).confirmacion.confirmacionId
    t.emitirDesde(CANALES.chatConfirmar, true, 'a', id, false)
    await expect(respuesta).resolves.toBe(false)
  })

  it('una respuesta de un remitente ajeno, de otro turno, con un id que no existe o con tipos raros se ignora', async () => {
    const t = montar()
    t.enviar({ id: 'a', texto: 'x' })
    await esperar()
    let resuelta: boolean | null = null
    void t.proveedor.confirmar({ titulo: 'T', detalle: 'D' })?.then((v) => (resuelta = v))
    const id = (t.eventosChat().find((e) => e.tipo === 'confirmar') as Extract<EventoChat, { tipo: 'confirmar' }>).confirmacion.confirmacionId
    t.emitirDesde(CANALES.chatConfirmar, false, 'a', id, true) // remitente ajeno
    t.emitirDesde(CANALES.chatConfirmar, true, 'otro', id, true) // otro turno
    t.emitirDesde(CANALES.chatConfirmar, true, 'a', 'no-existe', true)
    t.emitirDesde(CANALES.chatConfirmar, true, 'a', id, 'true') // no es booleano
    t.emitirDesde(CANALES.chatConfirmar, true, 'a', 42, true)
    t.emitirDesde(CANALES.chatConfirmar, true, 7, id, true)
    await esperar()
    expect(resuelta).toBeNull()
    t.emitirDesde(CANALES.chatConfirmar, true, 'a', id, true)
    await esperar()
    expect(resuelta).toBe(true)
  })

  it('detener el turno cierra la tarjeta pendiente como «no»', async () => {
    const t = montar()
    t.enviar({ id: 'a', texto: 'x' })
    await esperar()
    const respuesta = t.proveedor.confirmar({ titulo: 'T', detalle: 'D' })
    t.emitirDesde(CANALES.chatCancelar, true, 'a')
    await expect(respuesta).resolves.toBe(false)
  })

  it('al terminar el turno, una tarjeta sin contestar cuenta como «no» y ya no se puede contestar', async () => {
    const t = montar()
    t.enviar({ id: 'a', texto: 'x' })
    await esperar()
    const respuesta = t.proveedor.confirmar({ titulo: 'T', detalle: 'D' })
    t.proveedor.terminar()
    await expect(respuesta).resolves.toBe(false)
  })

  it('en la memoria, el texto de antes y de después de una acción se separa en párrafos', async () => {
    const { memoria, llamadas } = memoriaFalsa()
    const t = montar(true, memoria)
    t.enviar({ id: 'a', texto: 'Busca' })
    await esperar()
    t.proveedor.decir('Voy a buscar.')
    t.proveedor.accion(accion('en_curso'))
    t.proveedor.accion(accion('ok'))
    t.proveedor.decir('Esto es lo que encontré.')
    t.proveedor.terminar()
    await esperar()
    expect(llamadas.completados).toEqual([['Busca', 'Voy a buscar.\n\nEsto es lo que encontré.']])
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
