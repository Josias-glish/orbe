import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PASOS, colocarBocadillo, pideTutorial, unirCajas } from '../src/renderer/chat/tutorial'

describe('tutorial', () => {
  it('reconoce la orden «tutorial» y no la confunde con una pregunta', () => {
    for (const t of ['tutorial', 'Tutorial.', 'ver el tutorial', 'repite el tutorial!', '  abre tutorial ']) expect(pideTutorial(t)).toBe(true)
    for (const t of ['¿cómo hago un tutorial de Excel?', 'tutorial de python', 'busca un tutorial']) expect(pideTutorial(t)).toBe(false)
  })

  it('cada paso apunta a controles que existen en el panel', () => {
    const html = readFileSync(join(__dirname, '../src/renderer/index.html'), 'utf8')
    const ids = PASOS.flatMap((p) => (p.objetivo ?? '').split(',').map((s) => s.trim()).filter(Boolean))
    expect(ids.length).toBeGreaterThan(8)
    for (const s of ids) expect(html, s).toContain(`id="${s.slice(1)}"`)
    expect(PASOS[0]!.objetivo).toBeNull()
    expect(PASOS.at(-1)!.objetivo).toBeNull()
  })

  it('coloca el bocadillo dentro del panel: al lado del carril, debajo si cabe y si no encima', () => {
    const panel = { ancho: 500, alto: 600 }
    const b = { ancho: 290, alto: 150 }
    // Botón del carril izquierdo: a su derecha.
    expect(colocarBocadillo({ x: 8, y: 100, ancho: 36, alto: 36 }, panel, b)).toEqual({ x: 56, y: 43 })
    // Botón de la cabecera: debajo, sin salirse por la derecha.
    expect(colocarBocadillo({ x: 460, y: 10, ancho: 30, alto: 30 }, panel, b)).toEqual({ x: 198, y: 52 })
    // La caja de texto, abajo del todo: encima.
    expect(colocarBocadillo({ x: 60, y: 540, ancho: 400, alto: 40 }, panel, b)).toEqual({ x: 115, y: 378 })
    // Sin objetivo: centrado.
    expect(colocarBocadillo(null, panel, b)).toEqual({ x: 105, y: 225 })
  })

  it('une varios controles en un solo recuadro', () => {
    expect(unirCajas([])).toBeNull()
    expect(unirCajas([{ x: 10, y: 20, ancho: 30, alto: 30 }, { x: 50, y: 20, ancho: 30, alto: 40 }])).toEqual({ x: 10, y: 20, ancho: 70, alto: 40 })
  })
})
