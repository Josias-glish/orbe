import { describe, expect, it } from 'vitest'
import type { ProveedorChat, ManejadoresTurno } from '../src/main/chat/proveedor'
import type { TurnoEntrada } from '../src/main/chat/contenido'
import { siguienteEjecucion, validarTarea } from '../src/main/tareas/programa'
import { MARCA_NADA, promptTarea, ServicioTareas } from '../src/main/tareas/servicio'
import { BusActividad } from '../src/main/conectores/actividad'
import { describirPrograma } from '../src/shared/tareas'

const local = (y: number, m: number, d: number, h = 0, min = 0): number => new Date(y, m - 1, d, h, min).getTime()

describe('siguienteEjecucion', () => {
  it('diaria: hoy si aún no pasó la hora, si no mañana', () => {
    expect(siguienteEjecucion({ tipo: 'diaria', hora: '08:30' }, local(2026, 11, 9, 7))).toBe(local(2026, 11, 9, 8, 30))
    expect(siguienteEjecucion({ tipo: 'diaria', hora: '08:30' }, local(2026, 11, 9, 8, 30))).toBe(local(2026, 11, 10, 8, 30))
  })

  it('semanal: el próximo día marcado (9/11/2026 es lunes)', () => {
    const p = { tipo: 'semanal' as const, dias: [3, 5], hora: '18:00' }
    expect(siguienteEjecucion(p, local(2026, 11, 9, 12))).toBe(local(2026, 11, 11, 18))
    expect(siguienteEjecucion(p, local(2026, 11, 13, 19))).toBe(local(2026, 11, 18, 18))
  })

  it('cada N minutos: múltiplos desde que se creó, sin desplazarse', () => {
    const creada = local(2026, 11, 9, 10)
    expect(siguienteEjecucion({ tipo: 'cada', minutos: 60 }, creada, creada)).toBe(local(2026, 11, 9, 11))
    expect(siguienteEjecucion({ tipo: 'cada', minutos: 60 }, local(2026, 11, 9, 13, 20), creada)).toBe(local(2026, 11, 9, 14))
  })

  it('una vez: solo si es futura; ahora: nunca se repite', () => {
    expect(siguienteEjecucion({ tipo: 'una-vez', en: 2000 }, 1000)).toBe(2000)
    expect(siguienteEjecucion({ tipo: 'una-vez', en: 2000 }, 3000)).toBeNull()
    expect(siguienteEjecucion({ tipo: 'ahora' }, 1000)).toBeNull()
  })
})

describe('validarTarea', () => {
  it('pone un título si falta y rechaza horas, intervalos y días imposibles', () => {
    const ok = validarTarea({ instruccion: 'Resume las noticias de hoy', programa: { tipo: 'diaria', hora: '07:05' } })
    expect(ok.ok && ok.tarea.titulo).toBe('Resume las noticias de hoy')
    expect(validarTarea({ instruccion: 'x', programa: { tipo: 'diaria', hora: '25:00' } }).ok).toBe(false)
    expect(validarTarea({ instruccion: 'x', programa: { tipo: 'cada', minutos: 1 } }).ok).toBe(false)
    expect(validarTarea({ instruccion: 'x', programa: { tipo: 'semanal', dias: [9], hora: '08:00' } }).ok).toBe(false)
    expect(validarTarea({ instruccion: '  ', programa: { tipo: 'ahora' } }).ok).toBe(false)
  })

  it('describe el programa en español', () => {
    expect(describirPrograma({ tipo: 'semanal', dias: [0, 1, 3], hora: '18:00' })).toBe('Lun, Mié, Dom a las 18:00')
    expect(describirPrograma({ tipo: 'cada', minutos: 120 })).toBe('Cada 2 h')
  })
})

/** Un proveedor de mentira: responde lo que se le diga y, si se pide, solicita un permiso antes. */
class ProveedorFalso implements ProveedorChat {
  readonly nombre = 'api' as const
  readonly modelo = 'claude-haiku-5-5'
  ultimoTexto = ''
  cerrado = false
  constructor(
    private readonly respuesta: string,
    private readonly pedirPermiso = false
  ) {}
  async enviar(turno: TurnoEntrada, m: ManejadoresTurno) {
    this.ultimoTexto = turno.texto
    m.alUso?.({ entrada: 100, salida: 50 })
    if (this.pedirPermiso) {
      const ok = await m.confirmar!({ herramienta: 'abrir', titulo: 'Abrir la calculadora', detalle: 'calc.exe', peligrosa: false } as never)
      m.alTexto(ok ? 'Abierta.' : 'No me dejaste.')
      return { motivo: 'completo' as const }
    }
    m.alTexto(this.respuesta)
    return { motivo: 'completo' as const }
  }
  cancelar() {}
  reiniciar() {}
  cerrar() {
    this.cerrado = true
  }
}

const esperar = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 5))
}

describe('ServicioTareas', () => {
  it('hace una tarea «ahora», guarda el resultado, cuenta el consumo y avisa al personaje', async () => {
    const proveedores: ProveedorFalso[] = []
    const usos: number[] = []
    const bus = new BusActividad()
    const avisos: string[] = []
    const s = new ServicioTareas({
      archivo: null,
      crearProveedor: () => {
        const p = new ProveedorFalso('Hay 3 correos importantes.')
        proveedores.push(p)
        return p
      },
      bus,
      contador: { uso: (u) => usos.push(u.entrada) },
      notificar: (t) => avisos.push(t)
    })
    s.guardar({ titulo: 'Correo', instruccion: 'Revisa mi correo', programa: { tipo: 'ahora' } })
    await esperar(() => s.estado().tareas[0].ultima?.estado === 'completada')
    const t = s.estado().tareas[0]
    expect(t.ultima?.resultado).toBe('Hay 3 correos importantes.')
    expect(t.activa).toBe(false)
    expect(proveedores[0].ultimoTexto).toContain('Revisa mi correo')
    expect(proveedores[0].cerrado).toBe(true)
    expect(usos).toEqual([100])
    expect(bus.ultimos().map((e) => e.tipo)).toEqual(['inicio', 'terminado'])
    expect(avisos[0]).toContain('Correo')
  })

  it('con «solo si hay algo», una respuesta vacía queda como «nada nuevo» sin notificar', async () => {
    const avisos: string[] = []
    const s = new ServicioTareas({ archivo: null, crearProveedor: () => new ProveedorFalso(MARCA_NADA), notificar: (t) => avisos.push(t) })
    s.guardar({ titulo: 'Precio', instruccion: 'Mira el precio', programa: { tipo: 'ahora' }, soloSiHayAlgo: true })
    await esperar(() => s.estado().tareas[0].ultima?.estado === 'nada-nuevo')
    expect(s.estado().tareas[0].ultima?.estado).toBe('nada-nuevo')
    expect(avisos).toEqual([])
    expect(promptTarea({ titulo: 'x', instruccion: 'y', soloSiHayAlgo: true }, 0)).toContain(MARCA_NADA)
  })

  it('una acción que necesita permiso espera a que respondas', async () => {
    const s = new ServicioTareas({ archivo: null, crearProveedor: () => new ProveedorFalso('', true) })
    s.guardar({ titulo: 'Calc', instruccion: 'Abre la calculadora', programa: { tipo: 'ahora' } })
    await esperar(() => s.estado().tareas[0].ultima?.estado === 'esperando')
    const e = s.estado().tareas[0].ultima!
    expect(e.permiso?.titulo).toBe('Abrir la calculadora')
    s.responder(s.estado().tareas[0].id, e.permiso!.confirmacionId, true)
    await esperar(() => s.estado().tareas[0].ultima?.estado === 'completada')
    expect(s.estado().tareas[0].ultima?.resultado).toBe('Abierta.')
  })

  it('pone en cola lo que toca a su hora y calcula la siguiente', async () => {
    let t = local(2026, 11, 9, 8, 0)
    const s = new ServicioTareas({ archivo: null, crearProveedor: () => new ProveedorFalso('ok'), ahora: () => t })
    s.guardar({ titulo: 'Diaria', instruccion: 'Haz algo', programa: { tipo: 'diaria', hora: '08:30' } })
    expect(s.estado().tareas[0].proxima).toBe(local(2026, 11, 9, 8, 30))
    t = local(2026, 11, 9, 8, 31)
    s.revisar()
    await esperar(() => s.estado().tareas[0].ultima?.estado === 'completada')
    expect(s.estado().tareas[0].proxima).toBe(local(2026, 11, 10, 8, 30))
    expect(s.estado().tareas[0].activa).toBe(true)
  })

  it('sin modelo configurado lo explica', () => {
    const s = new ServicioTareas({ archivo: null, crearProveedor: null, motivoNoDisponible: 'Falta la clave.' })
    expect(s.estado()).toMatchObject({ disponible: false, motivo: 'Falta la clave.' })
  })
})
