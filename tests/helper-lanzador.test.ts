import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawn = vi.fn(() => ({ fake: true }))
vi.mock('node:child_process', () => ({ spawn }))

const { lanzadorPowerShell } = await import('../src/main/pantalla/helper-uia')

describe('lanzadorPowerShell', () => {
  beforeEach(() => spawn.mockClear())

  it('usa el PowerShell de Windows por su ruta completa, sin perfil ni ventana, y le pasa el pid y la caché', () => {
    const previo = process.env['SystemRoot']
    process.env['SystemRoot'] = 'C:\\Windows'
    try {
      lanzadorPowerShell('C:\\orbe\\helper')({ pidOrbe: 4321, cacheDir: 'C:\\datos\\uia-cache' })
    } finally {
      if (previo === undefined) delete process.env['SystemRoot']
      else process.env['SystemRoot'] = previo
    }

    expect(spawn).toHaveBeenCalledTimes(1)
    const [ejecutable, args, opciones] = spawn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>]
    expect(ejecutable.replace(/\//g, '\\')).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(args).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      expect.stringMatching(/uia-helper\.ps1$/),
      '-PidOrbe',
      '4321',
      '-CacheDir',
      'C:\\datos\\uia-cache'
    ])
    expect(String(args[5]).replace(/\//g, '\\')).toBe('C:\\orbe\\helper\\uia-helper.ps1')
    expect(opciones).toMatchObject({ windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  })
})
