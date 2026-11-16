// Descarga de verdad la última release de GitHub (unos 140 MB) y comprueba su SHA-256. Solo si lo pides:
//   PowerShell:  $env:ORBE_PRUEBA_REAL = '1'; npm test -- tests/integracion/actualizacion-real
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

import { Actualizador } from '../../src/main/actualizacion'
import type { EstadoActualizacion } from '../../src/shared/tipos'

describe.skipIf(process.env['ORBE_PRUEBA_REAL'] !== '1')('actualización real desde GitHub', () => {
  it('baja el instalador de Windows de la última release y su huella coincide', async () => {
    const carpeta = mkdtempSync(join(tmpdir(), 'orbe-act-real-'))
    const estados: EstadoActualizacion[] = []
    const a = new Actualizador({ versionActual: '0.0.1', plataforma: 'win32', arch: 'x64', portable: false, carpeta, emitir: (e) => estados.push(e), avisar: () => {} })
    await a.comprobar()
    console.log(estados.map((e) => (e.fase === 'descargando' ? `${e.progreso}%` : e.fase)).join(' '))
    expect(estados.at(-1)?.fase).toBe('lista')
    rmSync(carpeta, { recursive: true, force: true })
  }, 600_000)
})
