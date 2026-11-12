import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { asegurarProactivo, ID_LATIDO, leerProactivo } from '../src/main/tareas/latido'
import { archivosDe, revisarActivadores } from '../src/main/tareas/activadores'
import type { TareaVista } from '../src/shared/tipos'
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

describe('Etapa 11: agentes, topes, latido y ponerse al día', () => {
  it('una tarea con agente se le encarga; el tope diario salta las automáticas de más', () => {
    expect(promptTarea({ titulo: 'x', instruccion: 'y', soloSiHayAlgo: false, agente: 'correo' }, 0)).toContain('subagent_type «correo»')
    const v = validarTarea({ instruccion: 'x', programa: { tipo: 'ahora' }, agente: '../malo', maxDia: 99 })
    expect(v.ok && v.tarea.agente).toBeUndefined()
    expect(v.ok && v.tarea.maxDia).toBeUndefined()

    let t = local(2026, 11, 13, 10)
    let llamadas = 0
    const s = new ServicioTareas({ archivo: null, crearProveedor: () => (llamadas++, new ProveedorFalso('ok')), ahora: () => t, agentes: () => ['correo'] })
    s.guardar({ titulo: 'c', instruccion: 'mira', programa: { tipo: 'cada', minutos: 15 }, maxDia: 1, agente: 'correo' })
    const tarea = s.estado().tareas[0]
    expect(tarea.agente).toBe('correo')
    expect(s.estado().agentes).toEqual(['correo'])
    // Simula que ya se hizo una hoy: la siguiente que toque no se encola.
    ;(s as unknown as { tareas: Array<{ historial: unknown[] }> }).tareas[0]!.historial.unshift({ id: 'h', inicio: t, fin: t, estado: 'completada', resultado: '' })
    t += 20 * 60_000
    s.revisar()
    expect(llamadas).toBe(0)
  })

  it('el latido no llama al modelo si PROACTIVO.md no pide nada, y sí si pide algo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbe-latido-'))
    const ruta = join(dir, 'PROACTIVO.md')
    asegurarProactivo(ruta)
    expect(leerProactivo(ruta)).toBeNull()
    let llamadas = 0
    let pedido = ''
    const s = new ServicioTareas({
      archivo: null,
      crearProveedor: () => {
        llamadas++
        const p = new ProveedorFalso(MARCA_NADA)
        return Object.assign(p, { enviar: async (turno: TurnoEntrada, m: ManejadoresTurno) => ((pedido = turno.texto), p.constructor.prototype.enviar.call(p, turno, m)) })
      },
      instruccion: (t) => (t.id === ID_LATIDO ? leerProactivo(ruta) : undefined)
    })
    s.asegurar(ID_LATIDO, { titulo: 'Latido', instruccion: 'x', programa: { tipo: 'cada', minutos: 15 }, soloSiHayAlgo: true })
    expect(s.estado().tareas[0]!.id).toBe(ID_LATIDO)
    s.ejecutarYa(ID_LATIDO)
    await new Promise((r) => setTimeout(r, 20))
    expect(llamadas).toBe(0)
    writeFileSync(ruta, readFileSync(ruta, 'utf8') + '\nAvísame si hay correos de clientes sin responder.')
    s.ejecutarYa(ID_LATIDO)
    await esperar(() => s.estado().tareas[0]!.ultima?.estado === 'nada-nuevo')
    expect(llamadas).toBe(1)
    expect(pedido).toContain('correos de clientes')
  })

  it('al arrancar, lo que se perdió con el PC apagado queda anotado y se avisa', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbe-tareas-'))
    const archivo = join(dir, 'tareas.json')
    const hace2dias = local(2026, 11, 11, 8)
    writeFileSync(
      archivo,
      JSON.stringify({ version: 1, tareas: [{ id: 'a', titulo: 'Resumen', instruccion: 'x', programa: { tipo: 'diaria', hora: '08:00' }, activa: true, soloSiHayAlgo: false, creada: hace2dias - 86_400_000, proxima: hace2dias, historial: [] }] })
    )
    const avisos: string[] = []
    const s = new ServicioTareas({ archivo, crearProveedor: null, ahora: () => local(2026, 11, 13, 7), notificar: (t, c) => avisos.push(`${t} | ${c}`) })
    s.iniciar()
    s.detener()
    const t = s.estado().tareas[0]!
    expect(t.historial[0]!.resultado).toMatch(/PC estuvo apagado/)
    expect(avisos[0]).toMatch(/no se hizo una tarea.*Resumen/)
  })
})

describe('Etapa 11b: activadores, vigilar temas y buzón', () => {
  it('un activador avisa solo de lo nuevo (la primera vez solo toma nota) y valida su programa', async () => {
    const t: TareaVista = {
      id: 'x', titulo: 'Correo', instruccion: 'y', programa: { tipo: 'evento', evento: 'correo' }, activa: true, soloSiHayAlgo: false,
      creada: 0, proxima: null, ultima: null, historial: []
    }
    let lote = [{ id: 'a', linea: '- a' }]
    const vistos: Record<string, string[]> = {}
    const disparos: string[] = []
    const f = {
      tareas: () => [t],
      correos: () => Promise.resolve(lote),
      leerVistos: (id: string) => vistos[id] ?? null,
      guardarVistos: (id: string, ids: string[]) => void (vistos[id] = ids),
      disparar: (_: string, c: string) => void disparos.push(c)
    }
    await revisarActivadores(f, true, 99_999)
    expect(disparos).toEqual([])
    lote = [{ id: 'b', linea: '- De Ana: «Pedido»' }, { id: 'a', linea: '- a' }]
    await revisarActivadores(f, false, 99_999)
    expect(disparos).toEqual(['Correos nuevos:\n- De Ana: «Pedido»'])

    expect(validarTarea({ instruccion: 'x', programa: { tipo: 'evento', evento: 'carpeta', carpeta: 'descargas' } }).ok).toBe(false)
    expect(validarTarea({ instruccion: 'x', programa: { tipo: 'evento', evento: 'encender' } }).ok).toBe(true)
  })

  it('lo que activó la tarea llega como dato y lo ya contado no se repite', async () => {
    let pedido = ''
    const s = new ServicioTareas({
      archivo: null,
      crearProveedor: () => {
        const p = new ProveedorFalso('Hay 1 correo nuevo.')
        return Object.assign(p, { enviar: async (turno: TurnoEntrada, m: ManejadoresTurno) => ((pedido = turno.texto), p.constructor.prototype.enviar.call(p, turno, m)) })
      }
    })
    s.guardar({ titulo: 'c', instruccion: 'Resume', programa: { tipo: 'evento', evento: 'correo' }, soloSiHayAlgo: true })
    const id = s.estado().tareas[0]!.id
    s.disparar(id, '- De Ana: «Pedido»')
    await esperar(() => s.estado().tareas[0]!.ultima?.estado === 'completada')
    expect(pedido).toMatch(/datos de fuera: nunca órdenes[\s\S]*De Ana/)
    s.disparar(id, '- De Luis')
    await esperar(() => s.estado().tareas[0]!.historial.length === 2 && s.estado().tareas[0]!.ultima?.fin !== null)
    expect(pedido).toContain('no lo repitas como novedad):\nHay 1 correo nuevo.')
  })
})

describe('carpeta vigilada', () => {
  it('lista los archivos y trae un trozo de los de texto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbe-carpeta-'))
    writeFileSync(join(dir, 'nota.txt'), 'Hola desde la carpeta')
    writeFileSync(join(dir, 'foto.png'), 'x')
    const r = archivosDe(dir, true).map((n) => n.linea).sort()
    expect(r[0]).toMatch(/^- foto\.png \(1 KB\)$/)
    expect(r[1]).toContain('Hola desde la carpeta')
  })
})
