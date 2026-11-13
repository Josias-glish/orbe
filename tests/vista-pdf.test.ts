import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: { handle: () => {} }, shell: {} }))
const { pdfPermitido } = await import('../src/main/vista-pdf')

describe('vista previa de PDF', () => {
  it('solo enseña PDF que existen dentro de las carpetas de Orbe', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'orbe-vpdf-'))
    const informes = join(raiz, 'informes')
    mkdirSync(informes)
    writeFileSync(join(informes, 'a.pdf'), 'x')
    writeFileSync(join(raiz, 'fuera.pdf'), 'x')
    writeFileSync(join(informes, 'a.md'), 'x')
    expect(pdfPermitido(join(informes, 'a.pdf'), [informes])).toBe(join(informes, 'a.pdf'))
    expect(pdfPermitido(join(informes, '..', 'fuera.pdf'), [informes])).toBeNull()
    expect(pdfPermitido(join(informes, 'a.md'), [informes])).toBeNull()
    expect(pdfPermitido(join(informes, 'no.pdf'), [informes])).toBeNull()
    expect(pdfPermitido(42, [informes])).toBeNull()
  })
})
