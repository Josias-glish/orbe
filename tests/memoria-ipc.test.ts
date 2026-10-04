import type { BrowserWindow } from 'electron'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CANALES, type EstadoMemoria, type InformeImportacion, type InicioMemoria, type ResultadoMemoria } from '../src/shared/tipos'
import { prepararMemoriaDeMentira } from '../src/main/memoria/fuente-demo'
import { ServicioMemoria } from '../src/main/memoria/servicio'

type Manejador = (evento: unknown, ...args: unknown[]) => unknown

const electron = vi.hoisted(() => ({
  manejadores: new Map<string, (...args: unknown[]) => unknown>(),
  escuchas: new Map<string, (...args: unknown[]) => unknown>(),
  openPath: vi.fn(async () => '')
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (canal: string, fn: (...args: unknown[]) => unknown) => electron.manejadores.set(canal, fn),
    on: (canal: string, fn: (...args: unknown[]) => unknown) => electron.escuchas.set(canal, fn)
  },
  shell: { openPath: electron.openPath },
  BrowserWindow: class {}
}))

const { registrarMemoria } = await import('../src/main/memoria/ipc')

const PETICION_INVALIDA = { ok: false, error: 'Petición no válida.' }

function montar(conNotasDeClaude = true) {
  electron.manejadores.clear()
  electron.escuchas.clear()
  electron.openPath.mockClear()
  const base = mkdtempSync(join(tmpdir(), 'orbe-memipc-'))
  const webContents = {}
  const ventana = { webContents } as unknown as BrowserWindow
  const servicio = new ServicioMemoria({
    carpeta: join(base, 'memoria'),
    archivoConversacion: join(base, 'conversacion.json'),
    max: 6000,
    origenesClaude: conNotasDeClaude ? prepararMemoriaDeMentira(base) : []
  })
  servicio.iniciar()
  registrarMemoria(ventana, servicio)
  const invocar = async <T = unknown>(canal: string, propio: boolean, ...args: unknown[]): Promise<T> =>
    (await (electron.manejadores.get(canal) as Manejador)({ sender: propio ? webContents : {} }, ...args)) as T
  const emitir = (canal: string, propio: boolean, ...args: unknown[]): unknown =>
    (electron.escuchas.get(canal) as Manejador)({ sender: propio ? webContents : {} }, ...args)
  return { base, servicio, invocar, emitir }
}

beforeEach(() => electron.openPath.mockClear())

describe('memoria: remitente', () => {
  it('solo la ventana de Orbe puede usar los canales de memoria', async () => {
    const t = montar()
    const canales = [
      [CANALES.memoriaInicio],
      [CANALES.memoriaEstado],
      [CANALES.memoriaGuardar, 'algo'],
      [CANALES.memoriaActualizar, 'user-perfil-demo', { usar: false }],
      [CANALES.memoriaBorrar, 'user-perfil-demo'],
      [CANALES.memoriaImportar],
      [CANALES.memoriaActivar, false],
      [CANALES.memoriaVaciar]
    ] as const
    for (const [canal, ...args] of canales) {
      await expect(t.invocar(canal, false, ...args)).rejects.toThrow(/no autorizado/i)
    }
    t.emitir(CANALES.memoriaCarpeta, false)
    expect(electron.openPath).not.toHaveBeenCalled()
    // Y no ha cambiado nada.
    expect(t.servicio.estado().recuerdos).toHaveLength(3)
    expect(t.servicio.activa()).toBe(true)
  })
})

describe('memoria: lectura', () => {
  it('inicio devuelve la conversación guardada y el aviso de la primera importación (una vez)', async () => {
    const t = montar()
    t.servicio.turnoCompletado('hola', 'hola, ¿qué tal?')
    const a = await t.invocar<InicioMemoria>(CANALES.memoriaInicio, true)
    expect(a.mensajes).toEqual([
      { rol: 'usuario', texto: 'hola' },
      { rol: 'asistente', texto: 'hola, ¿qué tal?' }
    ])
    expect(a.bienvenida).toMatch(/He cargado 3 notas/)
    expect((await t.invocar<InicioMemoria>(CANALES.memoriaInicio, true)).bienvenida).toBeNull()
  })

  it('estado devuelve los recuerdos, lo que ocupan y la carpeta', async () => {
    const t = montar()
    const e = await t.invocar<EstadoMemoria>(CANALES.memoriaEstado, true)
    expect(e.recuerdos).toHaveLength(3)
    expect(e.presupuesto.max).toBe(6000)
    expect(e.carpeta).toBe(join(t.base, 'memoria'))
  })
})

describe('memoria: escritura', () => {
  it('guardar una nota; solo un true de verdad fuerza un dato delicado', async () => {
    const t = montar(false)
    const ok = await t.invocar<ResultadoMemoria>(CANALES.memoriaGuardar, true, 'Me gusta la astronomía')
    expect(ok.ok).toBe(true)
    const delicado = await t.invocar<ResultadoMemoria>(CANALES.memoriaGuardar, true, 'mi contraseña es hunter22', 'true')
    expect(delicado).toMatchObject({ ok: false, sensible: true })
    const forzado = await t.invocar<ResultadoMemoria>(CANALES.memoriaGuardar, true, 'mi contraseña es hunter22', true)
    expect(forzado.ok).toBe(true)
  })

  it.each([[42], [null], [undefined], [{}], ['x'.repeat(20_001)]])('guardar rechaza un texto inválido (%j)', async (texto) => {
    const t = montar(false)
    expect(await t.invocar(CANALES.memoriaGuardar, true, texto)).toEqual(PETICION_INVALIDA)
    expect(t.servicio.estado().recuerdos).toEqual([])
  })

  it('actualizar cambia solo los campos conocidos', async () => {
    const t = montar()
    const r = await t.invocar<ResultadoMemoria>(CANALES.memoriaActualizar, true, 'proyecto-huerto-demo', {
      usar: false,
      completo: true,
      titulo: 'Nuevo resumen',
      id: 'otro-id',
      origen: 'usuario',
      malicioso: '<script>'
    })
    expect(r.ok).toBe(true)
    const huerto = t.servicio.estado().recuerdos.find((x) => x.id === 'proyecto-huerto-demo')
    expect(huerto).toMatchObject({ usar: false, completo: true, titulo: 'Nuevo resumen', origen: 'claude' })
    expect(t.servicio.estado().recuerdos.some((x) => x.id === 'otro-id')).toBe(false)
    const archivo = readFileSync(join(t.base, 'memoria', 'proyecto-huerto-demo.md'), 'utf8')
    expect(archivo).not.toContain('malicioso')
  })

  it.each([
    ['un id con barras', '../fuera', { usar: false }],
    ['un id con mayúsculas', 'Proyecto', { usar: false }],
    ['un id que no es texto', 42, { usar: false }],
    ['cambios que no son un objeto', 'proyecto-huerto-demo', 'x'],
    ['cambios nulos', 'proyecto-huerto-demo', null],
    ['«usar» que no es booleano', 'proyecto-huerto-demo', { usar: 'sí' }],
    ['«completo» que no es booleano', 'proyecto-huerto-demo', { completo: 1 }],
    ['un título que no es texto', 'proyecto-huerto-demo', { titulo: 5 }],
    ['un texto desmesurado', 'proyecto-huerto-demo', { cuerpo: 'x'.repeat(20_001) }]
  ])('actualizar rechaza %s', async (_nombre, id, cambios) => {
    const t = montar()
    expect(await t.invocar(CANALES.memoriaActualizar, true, id, cambios)).toEqual(PETICION_INVALIDA)
  })

  it('actualizar un recuerdo que no existe da un error normal, sin lanzar', async () => {
    const t = montar()
    expect(await t.invocar(CANALES.memoriaActualizar, true, 'no-existe', { usar: false })).toMatchObject({ ok: false })
  })

  it('borrar valida el identificador', async () => {
    const t = montar()
    expect(await t.invocar(CANALES.memoriaBorrar, true, '../x')).toEqual(PETICION_INVALIDA)
    expect(await t.invocar(CANALES.memoriaBorrar, true, 7)).toEqual(PETICION_INVALIDA)
    expect(await t.invocar<ResultadoMemoria>(CANALES.memoriaBorrar, true, 'preferencias-demo')).toMatchObject({ ok: true })
    expect(t.servicio.estado().recuerdos.map((r) => r.id)).not.toContain('preferencias-demo')
  })

  it('activar solo acepta un booleano', async () => {
    const t = montar()
    expect(await t.invocar(CANALES.memoriaActivar, true, 'no')).toEqual(PETICION_INVALIDA)
    expect(await t.invocar(CANALES.memoriaActivar, true, 0)).toEqual(PETICION_INVALIDA)
    const apagada = await t.invocar<ResultadoMemoria>(CANALES.memoriaActivar, true, false)
    expect(apagada.ok && apagada.estado.activa).toBe(false)
    expect(t.servicio.activa()).toBe(false)
    const encendida = await t.invocar<ResultadoMemoria>(CANALES.memoriaActivar, true, true)
    expect(encendida.ok && encendida.estado.activa).toBe(true)
  })

  it('importar devuelve el informe y el estado', async () => {
    const t = montar()
    const { informe, estado } = await t.invocar<{ informe: InformeImportacion; estado: EstadoMemoria }>(CANALES.memoriaImportar, true)
    expect(informe).toMatchObject({ nuevas: 0, sinCambios: 3, fuentes: 1 })
    expect(estado.recuerdos).toHaveLength(3)
  })

  it('vaciar borra todos los recuerdos', async () => {
    const t = montar()
    const r = await t.invocar<ResultadoMemoria>(CANALES.memoriaVaciar, true)
    expect(r.ok && r.estado.recuerdos).toEqual([])
    expect(readdirSync(join(t.base, 'memoria')).filter((f) => f.endsWith('.md'))).toEqual([])
  })

  it('abrir la carpeta la crea si hace falta y la abre en el Explorador', () => {
    const t = montar(false)
    const carpeta = join(t.base, 'memoria')
    t.emitir(CANALES.memoriaCarpeta, true)
    expect(existsSync(carpeta)).toBe(true)
    expect(electron.openPath).toHaveBeenCalledWith(carpeta)
  })
})
