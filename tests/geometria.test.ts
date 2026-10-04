import { describe, expect, it } from 'vitest'
import {
  MARGEN_ESQUINA,
  TAM_COLAPSADO,
  TAM_EXPANDIDO,
  dentroDe,
  disposicionExpandida,
  posicionPorDefecto,
  rectColapsadoDesde,
  type Rect
} from '../src/main/geometria'

const area: Rect = { x: 0, y: 0, width: 1920, height: 1040 }

describe('posicionPorDefecto', () => {
  it('coloca el orbe en la esquina inferior derecha con margen', () => {
    const r = posicionPorDefecto(area)
    expect(r.x + r.width).toBe(area.width - MARGEN_ESQUINA)
    expect(r.y + r.height).toBe(area.height - MARGEN_ESQUINA)
  })

  it('respeta un área de trabajo desplazada (segundo monitor)', () => {
    const segundo: Rect = { x: 1920, y: 0, width: 1280, height: 720 }
    const r = posicionPorDefecto(segundo)
    expect(r.x).toBe(1920 + 1280 - TAM_COLAPSADO.width - MARGEN_ESQUINA)
  })
})

describe('dentroDe', () => {
  it('no mueve un rectángulo que ya cabe', () => {
    const r: Rect = { x: 100, y: 100, width: 120, height: 120 }
    expect(dentroDe(r, area)).toEqual(r)
  })

  it('empuja hacia dentro lo que se sale por cualquier borde', () => {
    expect(dentroDe({ x: -50, y: -20, width: 120, height: 120 }, area)).toMatchObject({ x: 0, y: 0 })
    expect(dentroDe({ x: 1900, y: 1030, width: 120, height: 120 }, area)).toMatchObject({
      x: 1920 - 120,
      y: 1040 - 120
    })
  })
})

describe('disposicionExpandida', () => {
  it('abajo a la derecha: el panel crece hacia arriba y a la izquierda, y el orbe no se mueve', () => {
    const colapsado = posicionPorDefecto(area)
    const { bounds, ancla } = disposicionExpandida(colapsado, area)
    expect(ancla).toEqual({ horizontal: 'derecha', vertical: 'abajo' })
    expect(bounds.width).toBe(TAM_EXPANDIDO.width)
    expect(bounds.height).toBe(TAM_EXPANDIDO.height)
    // La esquina inferior derecha de la ventana coincide con la del orbe colapsado.
    expect(bounds.x + bounds.width).toBe(colapsado.x + colapsado.width)
    expect(bounds.y + bounds.height).toBe(colapsado.y + colapsado.height)
  })

  it('arriba a la izquierda: el panel crece hacia abajo y a la derecha', () => {
    const colapsado: Rect = { ...TAM_COLAPSADO, x: 20, y: 20 }
    const { bounds, ancla } = disposicionExpandida(colapsado, area)
    expect(ancla).toEqual({ horizontal: 'izquierda', vertical: 'arriba' })
    expect(bounds.x).toBe(20)
    expect(bounds.y).toBe(20)
  })

  it('nunca se sale del área de trabajo', () => {
    const pequena: Rect = { x: 0, y: 0, width: 800, height: 600 }
    const colapsado: Rect = { ...TAM_COLAPSADO, x: 600, y: 400 }
    const { bounds } = disposicionExpandida(colapsado, pequena)
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(800)
  })
})

describe('rectColapsadoDesde', () => {
  it('es la inversa de disposicionExpandida cuando no hubo que desplazar', () => {
    const colapsado = posicionPorDefecto(area)
    const { bounds, ancla } = disposicionExpandida(colapsado, area)
    expect(rectColapsadoDesde(bounds, ancla)).toEqual(colapsado)
  })
})
