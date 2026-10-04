import { describe, expect, it } from 'vitest'
import type { EventoChat } from '../src/shared/tipos'
import type { TurnoEntrada } from '../src/main/chat/contenido'
import { ErrorChat, crearError } from '../src/main/chat/errores'
import type { ManejadoresTurno, ProveedorChat, ResultadoTurno } from '../src/main/chat/proveedor'
import { MAX_TEXTO, ServicioChat } from '../src/main/chat/servicio'

/** Proveedor controlable desde la prueba. */
class ProveedorFalso implements ProveedorChat {
  readonly nombre = 'cli' as const
  readonly modelo = 'falso'
  recibidos: TurnoEntrada[] = []
  cancelaciones = 0
  reinicios = 0
  calentado = 0
  cierres = 0
  private liberar: ((r: ResultadoTurno | Error) => void) | null = null
  manejadores: ManejadoresTurno | null = null

  enviar(turno: TurnoEntrada, manejadores: ManejadoresTurno): Promise<ResultadoTurno> {
    this.recibidos.push(turno)
    this.manejadores = manejadores
    return new Promise((resolver, rechazar) => {
      this.liberar = (r) => (r instanceof Error ? rechazar(r) : resolver(r))
    })
  }
  terminar(r: ResultadoTurno | Error): void {
    this.liberar?.(r)
  }
  cancelar(): void {
    this.cancelaciones++
  }
  reiniciar(): void {
    this.reinicios++
  }
  precalentar(): void {
    this.calentado++
  }
  cerrar(): void {
    this.cierres++
  }
}

function montar(): { servicio: ServicioChat; proveedor: ProveedorFalso; eventos: EventoChat[] } {
  const proveedor = new ProveedorFalso()
  const eventos: EventoChat[] = []
  const servicio = new ServicioChat(proveedor, (e) => eventos.push(e))
  return { servicio, proveedor, eventos }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('ServicioChat', () => {
  it('emite inicio, texto y fin en orden y recorta el mensaje', async () => {
    const { servicio, proveedor, eventos } = montar()
    expect(servicio.iniciar({ id: 'a', texto: '  Hola  ' })).toEqual({ ok: true })
    expect(proveedor.recibidos[0].texto).toBe('Hola')

    proveedor.manejadores?.alTexto('Ho')
    proveedor.manejadores?.alTexto('la')
    proveedor.terminar({ motivo: 'completo' })
    await tick()

    expect(eventos).toEqual([
      { tipo: 'inicio', id: 'a' },
      { tipo: 'texto', id: 'a', delta: 'Ho' },
      { tipo: 'texto', id: 'a', delta: 'la' },
      { tipo: 'fin', id: 'a', motivo: 'completo' }
    ])
  })

  it('reenvía reintentos y avisos del proveedor', async () => {
    const { servicio, proveedor, eventos } = montar()
    servicio.iniciar({ id: 'a', texto: 'x' })
    proveedor.manejadores?.alReintento?.(2, 3)
    proveedor.manejadores?.alAviso?.('se reinició')
    proveedor.terminar({ motivo: 'completo' })
    await tick()
    expect(eventos).toContainEqual({ tipo: 'reintento', id: 'a', intento: 2, maximo: 3 })
    expect(eventos).toContainEqual({ tipo: 'aviso', id: 'a', texto: 'se reinició' })
  })

  it('traduce un ErrorChat del proveedor a un evento de error', async () => {
    const { servicio, proveedor, eventos } = montar()
    servicio.iniciar({ id: 'a', texto: 'x' })
    const error = crearError('sin_sesion')
    proveedor.terminar(new ErrorChat(error))
    await tick()
    expect(eventos.at(-1)).toEqual({ tipo: 'error', id: 'a', error })
  })

  it('un error inesperado también llega como error, no como excepción', async () => {
    const { servicio, proveedor, eventos } = montar()
    servicio.iniciar({ id: 'a', texto: 'x' })
    proveedor.terminar(new Error('boom'))
    await tick()
    const ultimo = eventos.at(-1)
    expect(ultimo?.tipo).toBe('error')
    expect(ultimo?.tipo === 'error' && ultimo.error.codigo).toBe('desconocido')
  })

  it('rechaza un segundo mensaje mientras hay una respuesta en curso, y acepta otro al terminar', async () => {
    const { servicio, proveedor } = montar()
    expect(servicio.iniciar({ id: 'a', texto: 'uno' })).toEqual({ ok: true })
    const segundo = servicio.iniciar({ id: 'b', texto: 'dos' })
    expect(segundo.ok).toBe(false)
    expect(proveedor.recibidos).toHaveLength(1)

    proveedor.terminar({ motivo: 'completo' })
    await tick()
    expect(servicio.iniciar({ id: 'c', texto: 'tres' })).toEqual({ ok: true })
  })

  it.each([
    ['null', null],
    ['sin id', { texto: 'x' }],
    ['id vacío', { id: '', texto: 'x' }],
    ['id enorme', { id: 'x'.repeat(65), texto: 'x' }],
    ['texto vacío', { id: 'a', texto: '   ' }],
    ['texto no cadena', { id: 'a', texto: 5 }],
    ['texto enorme', { id: 'a', texto: 'x'.repeat(MAX_TEXTO + 1) }]
  ])('rechaza una petición no válida (%s)', (_nombre, peticion) => {
    const { servicio, proveedor } = montar()
    const r = servicio.iniciar(peticion)
    expect(r.ok).toBe(false)
    expect(proveedor.recibidos).toHaveLength(0)
  })

  it('solo cancela el turno que está en curso', () => {
    const { servicio, proveedor } = montar()
    servicio.iniciar({ id: 'a', texto: 'x' })
    servicio.cancelar('otro')
    expect(proveedor.cancelaciones).toBe(0)
    servicio.cancelar('a')
    expect(proveedor.cancelaciones).toBe(1)
  })

  it('nueva conversación, precalentar y cerrar llegan al proveedor', () => {
    const { servicio, proveedor } = montar()
    servicio.nueva()
    servicio.precalentar()
    servicio.cerrar()
    expect([proveedor.reinicios, proveedor.calentado, proveedor.cierres]).toEqual([1, 1, 1])
  })
})
