// Prueba con el lector de pantalla REAL (PowerShell + C# de helper/). Solo hace «ping»: compila el C#,
// comprueba el protocolo y no lee ninguna ventana. Solo corre en Windows y cuando lo pides:
//   PowerShell:  $env:ORBE_PRUEBA_REAL = '1'; npm test -- tests/integracion
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ClienteHelper } from '../../src/main/pantalla/helper-uia'

const activa = process.env['ORBE_PRUEBA_REAL'] === '1' && process.platform === 'win32'

describe.skipIf(!activa)('Lector de pantalla real', () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'orbe-uia-'))
  const cliente = new ClienteHelper({
    pidOrbe: process.pid,
    carpetaHelper: join(process.cwd(), 'helper'),
    cacheDir,
    arranqueMaxMs: 60_000
  })
  afterAll(() => {
    cliente.cerrar()
    try {
      rmSync(cacheDir, { recursive: true, force: true })
    } catch {
      // La DLL puede seguir bloqueada un instante; se limpiará con la carpeta temporal.
    }
  })

  it('compila el helper, arranca y responde a «ping»', async () => {
    await expect(cliente.pedir('ping', {}, 10_000)).resolves.toEqual({ pong: true })
  }, 90_000)

  it('rechaza con claridad una operación que no existe', async () => {
    await expect(cliente.pedir('no-existe', {}, 10_000)).rejects.toThrow(/desconoc|no-existe/i)
  }, 30_000)
})
