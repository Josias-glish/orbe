import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { carpetaTieneImagenes, elegirCarpetaFondos } from '../src/main/fondos'

describe('fondos incluidos en la instalación', () => {
  const siempre = (): boolean => true
  const nunca = (): boolean => false

  it('lo que el usuario configure manda sobre lo incluido', () => {
    expect(elegirCarpetaFondos('D:\mis-fondos', 'C:\app\fondos', siempre)).toBe('D:\mis-fondos')
  })

  it('sin configuración usa la carpeta incluida si tiene imágenes', () => {
    expect(elegirCarpetaFondos('', 'C:\app\fondos', siempre)).toBe('C:\app\fondos')
  })

  it('sin configuración ni imágenes incluidas no hay fondo', () => {
    expect(elegirCarpetaFondos('', 'C:\app\fondos', nunca)).toBeNull()
  })

  it('carpetaTieneImagenes: carpeta inexistente, vacía, sin imágenes y con imágenes', () => {
    const base = mkdtempSync(join(tmpdir(), 'orbe-fondos-incl-'))
    expect(carpetaTieneImagenes(join(base, 'no-existe'))).toBe(false)
    const vacia = join(base, 'vacia')
    mkdirSync(vacia)
    expect(carpetaTieneImagenes(vacia)).toBe(false)
    writeFileSync(join(vacia, 'nota.txt'), 'x')
    expect(carpetaTieneImagenes(vacia)).toBe(false)
    writeFileSync(join(vacia, 'a.JPG'), 'x')
    expect(carpetaTieneImagenes(vacia)).toBe(true)
  })
})
