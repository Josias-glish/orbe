// Lee el registro de ESTE PC y dice qué copia antigua de Orbe se quitaría, sin desinstalar nada. Solo si lo pides:
//   PowerShell:  $env:ORBE_PRUEBA_REAL = '1'; npm test -- tests/integracion/copias-real
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

import { borrarCopiasAntiguas, leerRegistroOrbe } from '../../src/main/actualizacion'

describe.skipIf(process.env['ORBE_PRUEBA_REAL'] !== '1' || process.platform !== 'win32')('copias de Orbe en este PC', () => {
  it('detecta las copias anteriores sin desinstalarlas', async () => {
    const desinstalar = vi.fn()
    const quitadas = await borrarCopiasAntiguas({
      versionActual: process.env['ORBE_VERSION'] || '1.26.0',
      carpetaActual: join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Orbe'),
      leerRegistro: leerRegistroOrbe,
      desinstalar,
      avisar: () => {}
    })
    console.log('Se quitarían:', JSON.stringify(quitadas), '→', JSON.stringify(desinstalar.mock.calls))
    expect(desinstalar).toHaveBeenCalledTimes(quitadas.length)
  })
})
