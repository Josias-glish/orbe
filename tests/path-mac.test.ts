import { describe, expect, it } from 'vitest'
import { extraerPath } from '../src/main/path-mac'

describe('extraerPath', () => {
  it('saca el PATH entre las marcas aunque la shell imprima avisos alrededor', () => {
    expect(extraerPath('Last login: hoy\n__ORBE_PATH__/opt/homebrew/bin:/usr/bin__ORBE_PATH__\n')).toBe('/opt/homebrew/bin:/usr/bin')
  })

  it('devuelve null si la salida no trae el PATH', () => {
    expect(extraerPath('zsh: command not found')).toBeNull()
    expect(extraerPath('__ORBE_PATH____ORBE_PATH__')).toBeNull()
  })
})
