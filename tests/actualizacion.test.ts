import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

import { Actualizador, borrarCopiasAntiguas, compararVersiones, copiasAntiguas, leerCopia, leerRelease, partirOrden } from '../src/main/actualizacion'
import { plantillaBandeja } from '../src/main/bandeja'
import type { EstadoActualizacion } from '../src/shared/tipos'

const CONTENIDO = Buffer.from('instalador de prueba '.repeat(5000))
const SHA = createHash('sha256').update(CONTENIDO).digest('hex')
const release = (version: string, sha = SHA) => ({
  tag_name: `v${version}`,
  html_url: `https://github.com/Josias-glish/orbe/releases/tag/v${version}`,
  assets: [
    { name: `Orbe-Setup-${version}.exe`, size: CONTENIDO.length, digest: `sha256:${sha}`, browser_download_url: `https://github.com/Josias-glish/orbe/releases/download/v${version}/Orbe-Setup-${version}.exe` },
    { name: `Orbe-${version}-mac-arm64.dmg`, size: 1, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: `https://github.com/x/Orbe-${version}-mac-arm64.dmg` }
  ]
})

const crear = (json: unknown, extra: { portable?: boolean; versionActual?: string } = {}) => {
  const estados: EstadoActualizacion[] = []
  const avisar = vi.fn()
  const pedir = vi.fn(async (url: string) => (url.includes('api.github.com') ? Response.json(json) : new Response(CONTENIDO))) as unknown as typeof fetch
  const carpeta = mkdtempSync(join(tmpdir(), 'orbe-act-'))
  const a = new Actualizador({ versionActual: extra.versionActual ?? '1.25.1', plataforma: 'win32', arch: 'x64', portable: extra.portable ?? false, carpeta, emitir: (e) => estados.push(e), avisar, pedir })
  return { a, estados, avisar, pedir, carpeta }
}

describe('actualizaciones', () => {
  it('compara versiones y elige el instalador de cada sistema', () => {
    expect(compararVersiones('1.26.0', '1.25.1')).toBe(1)
    expect(compararVersiones('v1.25.1', '1.25.1')).toBe(0)
    expect(compararVersiones('1.9.0', '1.10.0')).toBe(-1)
    expect(leerRelease(release('1.26.0'), 'win32', 'x64')?.activo?.nombre).toBe('Orbe-Setup-1.26.0.exe')
    expect(leerRelease(release('1.26.0'), 'darwin', 'arm64')?.activo?.nombre).toBe('Orbe-1.26.0-mac-arm64.dmg')
    expect(leerRelease({ tag_name: 'v1.26.0', assets: [{ name: 'Orbe-Setup-1.26.0.exe', browser_download_url: 'https://github.com/a' }] }, 'win32', 'x64')?.activo).toBeNull()
  })

  it('baja la versión nueva, comprueba su SHA-256, avisa y la ofrece en la bandeja', async () => {
    const { a, estados, avisar, carpeta } = crear(release('1.26.0'))
    await a.comprobar()
    expect(estados.at(-1)).toEqual({ fase: 'lista', version: '1.26.0' })
    expect(estados.some((e) => e.fase === 'descargando')).toBe(true)
    expect(avisar).toHaveBeenCalledWith('1.26.0')
    expect(readFileSync(join(carpeta, 'Orbe-Setup-1.26.0.exe')).equals(CONTENIDO)).toBe(true)
    const menu = plantillaBandeja({ alternarVisibilidad() {}, mostrarPanel() {}, nuevaConversacion() {}, leerPantalla() {}, detenerAccion() {}, instalarActualizacion() {}, salir() {} }, { visible: true, inicioDisponible: false, iniciaConWindows: false, alCambiarInicio() {}, actualizacionLista: '1.26.0' })
    expect(menu.map((m) => m.label)).toContain('Instalar actualización 1.26.0')
  })

  it('si la huella no coincide, la borra y no queda nada que instalar', async () => {
    const { a, estados, avisar, carpeta } = crear(release('1.26.0', 'b'.repeat(64)))
    await a.comprobar()
    expect(estados.at(-1)).toEqual({ fase: 'nada' })
    expect(avisar).not.toHaveBeenCalled()
    expect(existsSync(join(carpeta, 'Orbe-Setup-1.26.0.exe'))).toBe(false)
    expect(a.instalar(vi.fn(), vi.fn() as never)).toBe(false)
  })

  it('misma versión: nada; portable: solo aviso con enlace', async () => {
    const igual = crear(release('1.25.1'))
    await igual.a.comprobar()
    expect(igual.estados).toEqual([])
    const p = crear(release('1.26.0'), { portable: true })
    await p.a.comprobar()
    expect(p.estados).toEqual([{ fase: 'aviso', version: '1.26.0', pagina: 'https://github.com/Josias-glish/orbe/releases/tag/v1.26.0' }])
    expect(p.pedir).toHaveBeenCalledTimes(1)
  })

  it('instala en silencio y vuelve a abrir (el instalador decide dónde)', async () => {
    const { a } = crear(release('1.26.0'))
    await a.comprobar()
    const unref = vi.fn()
    const lanzar = vi.fn(() => ({ unref }))
    expect(a.instalar(vi.fn(), lanzar as never)).toBe(true)
    expect((lanzar.mock.calls[0] as unknown[])[1]).toEqual(['/S', '--force-run'])
    expect(unref).toHaveBeenCalled()
  })
})

// Salida real de `reg query` en el PC del usuario (15-nov), con los finales de línea de Windows.
const REG_TODOS = [
  'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\f1db034b-5259-5a30-bd19-fdf7c3750484',
  '    QuietUninstallString    REG_SZ    "C:\\Program Files\\Orbe\\Uninstall Orbe.exe" /allusers /S',
  '    DisplayVersion    REG_SZ    1.25.1',
  ''
].join('\r\n')
const REG_MIO = [
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\f1db034b-5259-5a30-bd19-fdf7c3750484',
  '    DisplayVersion    REG_SZ    1.26.0',
  '    QuietUninstallString    REG_SZ    "C:\\Users\\yo\\AppData\\Local\\Programs\\Orbe\\Uninstall Orbe.exe" /currentuser /S',
  ''
].join('\r\n')
const CARPETA_MIA = 'C:\\Users\\yo\\AppData\\Local\\Programs\\Orbe'

describe('borrar la versión anterior', () => {
  it('lee la copia del registro y parte la orden de desinstalar', () => {
    expect(leerCopia(REG_TODOS, true)).toEqual({ todos: true, version: '1.25.1', desinstalar: '"C:\\Program Files\\Orbe\\Uninstall Orbe.exe" /allusers /S' })
    expect(partirOrden('"C:\\Program Files\\Orbe\\Uninstall Orbe.exe" /allusers /S')).toEqual({ exe: 'C:\\Program Files\\Orbe\\Uninstall Orbe.exe', args: ['/allusers', '/S'] })
    expect(leerCopia('sin nada', false)).toBeNull()
  })

  it('quita la anterior del otro sitio, con permiso de administrador si es de todos los usuarios', async () => {
    const desinstalar = vi.fn()
    const avisar = vi.fn()
    const leerRegistro = async (raiz: 'HKCU' | 'HKLM') => (raiz === 'HKLM' ? REG_TODOS : REG_MIO)
    const quitadas = await borrarCopiasAntiguas({ versionActual: '1.26.0', carpetaActual: CARPETA_MIA, leerRegistro, desinstalar, avisar })
    expect(quitadas.map((c) => c.version)).toEqual(['1.25.1'])
    expect(desinstalar).toHaveBeenCalledWith('C:\\Program Files\\Orbe\\Uninstall Orbe.exe', ['/allusers', '/S'], true)
    expect(avisar).toHaveBeenCalledWith('1.25.1', true)
  })

  it('nunca quita la copia que corre ni una más nueva', async () => {
    const desinstalar = vi.fn()
    // Corre la vieja (1.25.1, en Program Files): la 1.26.0 del usuario es más nueva y se queda.
    await borrarCopiasAntiguas({ versionActual: '1.25.1', carpetaActual: 'C:\\Program Files\\Orbe', leerRegistro: async (r) => (r === 'HKLM' ? REG_TODOS : REG_MIO), desinstalar, avisar: vi.fn() })
    // Solo hay una copia, la propia.
    await borrarCopiasAntiguas({ versionActual: '1.26.0', carpetaActual: CARPETA_MIA, leerRegistro: async (r) => (r === 'HKCU' ? REG_MIO : null), desinstalar, avisar: vi.fn() })
    expect(desinstalar).not.toHaveBeenCalled()
    expect(copiasAntiguas([{ todos: false, version: '1.0.0', desinstalar: `"${CARPETA_MIA}\\Uninstall Orbe.exe" /S` }], '1.26.0', CARPETA_MIA)).toEqual([])
  })
})
