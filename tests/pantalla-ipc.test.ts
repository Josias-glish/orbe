import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANALES, type EventoPantalla, type LecturaPantalla } from '../src/shared/tipos'
import type { ContenidoUia, FuenteUia, TextoUia, VentanaUia } from '../src/main/pantalla/contexto'
import { CADUCIDAD_POR_DEFECTO_MS } from '../src/main/pantalla/pendiente'
import type { VentanaOrbe } from '../src/main/ventana'

type Manejador = (evento: unknown, ...args: unknown[]) => unknown

const electron = vi.hoisted(() => ({
  manejadores: new Map<string, (...args: unknown[]) => unknown>(),
  escuchas: new Map<string, (...args: unknown[]) => unknown>()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, fn: (...args: unknown[]) => unknown) => electron.manejadores.set(canal, fn),
    on: (canal: string, fn: (...args: unknown[]) => unknown) => electron.escuchas.set(canal, fn)
  }
}))

const { registrarPantalla } = await import('../src/main/pantalla/ipc')

const TEXTO =
  'Pela y corta las patatas en láminas finas y pocha las patatas con la cebolla a fuego lento durante veinte minutos. ' +
  'Bate los huevos con una pizca de sal y mezcla con las patatas escurridas. Déjala reposar unos minutos antes de servir.'

const VENTANA: VentanaUia = {
  hwnd: 5,
  pid: 50,
  proceso: 'msedge',
  aplicacion: 'Microsoft Edge',
  titulo: 'Receta',
  esNavegador: true,
  url: 'https://example.com/receta?sesion=secreta',
  barra: null,
  primerPlano: true,
  restringida: false
}

interface Escenario {
  ventana: VentanaUia | null | Error
  seleccion: string | null
  contenido: string | null
}

function montar(inicial: Partial<Escenario> = {}) {
  electron.manejadores.clear()
  electron.escuchas.clear()
  const escenario: Escenario = { ventana: VENTANA, seleccion: null, contenido: TEXTO, ...inicial }
  const orden: string[] = []
  const enviados: Array<{ canal: string; evento: EventoPantalla }> = []
  const webContents = {
    send: (canal: string, evento: EventoPantalla) => {
      enviados.push({ canal, evento })
      orden.push(`evento:${evento.tipo}`)
    }
  }
  const ventanaOrbe = {
    ventana: { webContents, isDestroyed: () => false },
    mostrar: vi.fn(() => orden.push('mostrar')),
    establecerExpandido: vi.fn((v: boolean) => orden.push(`expandir:${v}`))
  }
  const fuente: FuenteUia = {
    async ventana() {
      orden.push('leer-ventana')
      if (escenario.ventana instanceof Error) throw escenario.ventana
      return escenario.ventana
    },
    async seleccion(): Promise<TextoUia> {
      return { texto: escenario.seleccion, metodo: escenario.seleccion ? 'foco' : null }
    },
    async contenido(): Promise<ContenidoUia> {
      return { texto: escenario.contenido, metodo: escenario.contenido ? 'documento' : null, parcial: false }
    }
  }
  const pantalla = registrarPantalla({ ventana: ventanaOrbe as unknown as VentanaOrbe, fuente, contextoMax: 8000 })
  const invocar = (canal: string, propio: boolean, ...args: unknown[]): unknown =>
    (electron.manejadores.get(canal) as Manejador)({ sender: propio ? webContents : {} }, ...args)
  const emitirDesde = (canal: string, propio: boolean, ...args: unknown[]): unknown =>
    (electron.escuchas.get(canal) as Manejador)({ sender: propio ? webContents : {} }, ...args)
  const eventos = (): EventoPantalla[] => enviados.filter((e) => e.canal === CANALES.pantallaEvento).map((e) => e.evento)
  return { escenario, orden, ventanaOrbe, pantalla, invocar, emitirDesde, eventos }
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
afterEach(() => vi.useRealTimers())

describe('pantalla:leer', () => {
  it('lee la ventana, deja el contexto en el proceso principal y a la interfaz solo le da las vistas', async () => {
    const t = montar()
    const r = (await t.invocar(CANALES.pantallaLeer, true)) as { ok: true } & LecturaPantalla
    expect(r.ok).toBe(true)
    expect(r.partes.map((p) => p.clave)).toEqual(['ventana', 'contenido'])
    expect(t.pantalla.pendiente.hay()).toBe(true)
    // La interfaz no recibe el contexto en bruto, solo los chips y avisos.
    expect(Object.keys(r).sort()).toEqual(['avisos', 'ok', 'partes', 'sugerirCaptura'])
    // La dirección ya va sin parámetros.
    expect(JSON.stringify(t.pantalla.pendiente.consumir()!.contexto)).not.toContain('secreta')
  })

  it('si no hay ventana que leer devuelve el error (sin lanzarlo) y no deja nada pendiente', async () => {
    const t = montar({ ventana: null })
    const r = (await t.invocar(CANALES.pantallaLeer, true)) as { ok: false; error: { codigo: string } }
    expect(r.ok).toBe(false)
    expect(r.error.codigo).toBe('sin_ventana')
    expect(t.pantalla.pendiente.hay()).toBe(false)
  })

  it('si el lector se rompe, lo traduce a «lector no disponible»', async () => {
    const t = montar({ ventana: new Error('PowerShell murió') })
    const r = (await t.invocar(CANALES.pantallaLeer, true)) as { ok: false; error: { codigo: string; detalle?: string } }
    expect(r.error.codigo).toBe('lector_no_disponible')
    expect(r.error.detalle).toBe('PowerShell murió')
  })

  it('solo atiende a la ventana de Orbe', async () => {
    const t = montar()
    await expect(Promise.resolve().then(() => t.invocar(CANALES.pantallaLeer, false))).rejects.toThrow(/no autorizado/i)
    expect(t.orden).not.toContain('leer-ventana') // ni siquiera se lee la pantalla
    expect(t.pantalla.pendiente.hay()).toBe(false)
  })
})

describe('pantalla:quitar y pantalla:descartar', () => {
  it('quitar un trozo devuelve la lectura que queda', async () => {
    const t = montar()
    await t.invocar(CANALES.pantallaLeer, true)
    const l = (await t.invocar(CANALES.pantallaQuitar, true, 'contenido')) as LecturaPantalla
    expect(l.partes.map((p) => p.clave)).toEqual(['ventana'])
    expect(t.pantalla.pendiente.consumir()!.contexto.contenido).toBeUndefined()
  })

  it.each([42, null, undefined, {}, 'otra', '__proto__', 'constructor'])('una clave inválida (%j) no hace nada', async (clave) => {
    const t = montar()
    await t.invocar(CANALES.pantallaLeer, true)
    expect(await t.invocar(CANALES.pantallaQuitar, true, clave)).toBeNull()
    expect(t.pantalla.pendiente.lectura()!.partes).toHaveLength(2)
  })

  it('un remitente ajeno no puede quitar ni descartar', async () => {
    const t = montar()
    await t.invocar(CANALES.pantallaLeer, true)
    expect(await t.invocar(CANALES.pantallaQuitar, false, 'contenido')).toBeNull()
    t.emitirDesde(CANALES.pantallaDescartar, false)
    expect(t.pantalla.pendiente.lectura()!.partes).toHaveLength(2)
  })

  it('descartar vacía lo pendiente', async () => {
    const t = montar()
    await t.invocar(CANALES.pantallaLeer, true)
    t.emitirDesde(CANALES.pantallaDescartar, true)
    expect(t.pantalla.pendiente.hay()).toBe(false)
  })
})

describe('el atajo «leer pantalla»', () => {
  it('lee primero y abre el panel después (así la ventana del usuario aún tiene el foco)', async () => {
    const t = montar({ seleccion: 'da la vuelta con un plato' })
    await t.pantalla.leerConAtajo()

    expect(t.orden).toEqual(['evento:leyendo', 'leer-ventana', 'mostrar', 'expandir:true', 'evento:pendiente', 'evento:leyendo'])
    const [inicio, pendiente, fin] = t.eventos()
    expect(inicio).toEqual({ tipo: 'leyendo', activo: true })
    expect(pendiente).toMatchObject({ tipo: 'pendiente', origen: 'atajo' })
    expect((pendiente as { lectura: LecturaPantalla }).lectura.partes.map((p) => p.clave)).toEqual(['ventana', 'seleccion'])
    expect(fin).toEqual({ tipo: 'leyendo', activo: false })
    expect(t.pantalla.pendiente.hay()).toBe(true)
  })

  it('si no se puede leer, abre el panel igualmente y enseña el error', async () => {
    const t = montar({ ventana: null })
    await t.pantalla.leerConAtajo()
    expect(t.ventanaOrbe.mostrar).toHaveBeenCalledTimes(1)
    expect(t.ventanaOrbe.establecerExpandido).toHaveBeenCalledWith(true)
    const tipos = t.eventos().map((e) => e.tipo)
    expect(tipos).toEqual(['leyendo', 'error', 'leyendo'])
    expect(t.eventos()[1]).toMatchObject({ tipo: 'error', error: { codigo: 'sin_ventana' } })
    expect(t.eventos()[2]).toEqual({ tipo: 'leyendo', activo: false })
    expect(t.pantalla.pendiente.hay()).toBe(false)
  })
})

describe('caducidad del contexto pendiente', () => {
  it('a los cinco minutos se olvida y la interfaz se entera', async () => {
    const t = montar()
    await t.invocar(CANALES.pantallaLeer, true)
    vi.advanceTimersByTime(CADUCIDAD_POR_DEFECTO_MS + 10)
    expect(t.pantalla.pendiente.hay()).toBe(false)
    expect(t.eventos()).toEqual([{ tipo: 'vacio', motivo: 'caducado' }])
  })
})
