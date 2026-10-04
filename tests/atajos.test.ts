import { beforeEach, describe, expect, it, vi } from 'vitest'

// Un globalShortcut de mentira: algunos atajos están «ocupados» por otra aplicación y otros son inválidos.
const globalShortcut = vi.hoisted(() => {
  const ocupados = new Set<string>()
  const invalidos = new Set<string>()
  const registrados = new Map<string, () => void>()
  return {
    ocupados,
    invalidos,
    registrados,
    register: vi.fn((acelerador: string, accion: () => void): boolean => {
      if (invalidos.has(acelerador)) throw new TypeError(`Invalid accelerator: ${acelerador}`)
      if (ocupados.has(acelerador)) return false
      registrados.set(acelerador, accion)
      return true
    }),
    unregisterAll: vi.fn(() => registrados.clear())
  }
})
vi.mock('electron', () => ({ globalShortcut }))

const { ATAJOS_POR_DEFECTO, liberarAtajos, registrarAtajos } = await import('../src/main/atajos')

const acciones = () => ({ alternarPanel: vi.fn(), leerPantalla: vi.fn() })

beforeEach(() => {
  globalShortcut.ocupados.clear()
  globalShortcut.invalidos.clear()
  globalShortcut.registrados.clear()
  globalShortcut.register.mockClear()
  globalShortcut.unregisterAll.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('registrarAtajos', () => {
  it('por defecto: Ctrl+Mayús+Espacio abre/cierra el panel y Ctrl+Mayús+Alt+Espacio lee la pantalla', () => {
    expect(ATAJOS_POR_DEFECTO).toEqual({ panel: 'CommandOrControl+Shift+Space', leer: 'CommandOrControl+Shift+Alt+Space' })
    const a = acciones()
    const r = registrarAtajos(a)
    expect(r).toEqual({ registrados: ['CommandOrControl+Shift+Space', 'CommandOrControl+Shift+Alt+Space'], fallidos: [] })

    globalShortcut.registrados.get('CommandOrControl+Shift+Space')!()
    expect(a.alternarPanel).toHaveBeenCalledTimes(1)
    expect(a.leerPantalla).not.toHaveBeenCalled()
    globalShortcut.registrados.get('CommandOrControl+Shift+Alt+Space')!()
    expect(a.leerPantalla).toHaveBeenCalledTimes(1)
  })

  it('un atajo ocupado por otra aplicación se anota y no impide el otro', () => {
    globalShortcut.ocupados.add(ATAJOS_POR_DEFECTO.panel)
    const r = registrarAtajos(acciones())
    expect(r.fallidos).toEqual([ATAJOS_POR_DEFECTO.panel])
    expect(r.registrados).toEqual([ATAJOS_POR_DEFECTO.leer])
  })

  it('un atajo mal escrito (Electron lanza una excepción) no tumba la aplicación', () => {
    globalShortcut.invalidos.add('Ctrl+Nada+Raro')
    const r = registrarAtajos(acciones(), { panel: 'Ctrl+Nada+Raro', leer: 'Ctrl+Alt+L' })
    expect(r).toEqual({ registrados: ['Ctrl+Alt+L'], fallidos: ['Ctrl+Nada+Raro'] })
  })

  it('si los dos atajos configurados son iguales, solo vale el del panel', () => {
    const a = acciones()
    const r = registrarAtajos(a, { panel: 'Ctrl+Alt+O', leer: 'Ctrl+Alt+O' })
    expect(r.registrados).toEqual(['Ctrl+Alt+O'])
    expect(r.fallidos).toEqual(['Ctrl+Alt+O'])
    globalShortcut.registrados.get('Ctrl+Alt+O')!()
    expect(a.alternarPanel).toHaveBeenCalledTimes(1)
    expect(a.leerPantalla).not.toHaveBeenCalled()
  })

  it('avisa por consola de los atajos que no pudo registrar', () => {
    globalShortcut.ocupados.add(ATAJOS_POR_DEFECTO.leer)
    registrarAtajos(acciones())
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(console.warn).mock.calls[0].join(' '))).toContain(ATAJOS_POR_DEFECTO.leer)
  })

  it('liberarAtajos los suelta todos', () => {
    registrarAtajos(acciones())
    liberarAtajos()
    expect(globalShortcut.unregisterAll).toHaveBeenCalledTimes(1)
    expect(globalShortcut.registrados.size).toBe(0)
  })
})
