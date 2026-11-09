import { describe, expect, it } from 'vitest'
import { enCentroPersonaje, zonaInteractiva } from '../src/renderer/zona-raton'

const caja = { left: 0, top: 0, width: 150, height: 150 }

describe('zona del ratón del personaje', () => {
  it('el centro del personaje se puede tocar; las esquinas y los bordes no', () => {
    expect(enCentroPersonaje(75, 81, caja)).toBe(true)
    expect(enCentroPersonaje(75, 30, caja)).toBe(true)
    expect(enCentroPersonaje(5, 5, caja)).toBe(false)
    expect(enCentroPersonaje(145, 145, caja)).toBe(false)
    expect(enCentroPersonaje(20, 81, caja)).toBe(false)
    expect(enCentroPersonaje(130, 81, caja)).toBe(false)
    expect(enCentroPersonaje(75, 2, caja)).toBe(false)
  })

  it('respeta dónde está la caja dentro de la ventana (panel abierto)', () => {
    const abajo = { left: 230, top: 504, width: 150, height: 150 }
    expect(enCentroPersonaje(305, 585, abajo)).toBe(true)
    expect(enCentroPersonaje(75, 81, abajo)).toBe(false)
    expect(enCentroPersonaje(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toBe(false)
  })

  it('el panel abierto, un arrastre o un botón propio también reciben el ratón', () => {
    const nada = { arrastrando: false, sobrePanel: false, sobreBoton: false, enCentro: false }
    expect(zonaInteractiva(nada)).toBe(false)
    expect(zonaInteractiva({ ...nada, sobrePanel: true })).toBe(true)
    expect(zonaInteractiva({ ...nada, arrastrando: true })).toBe(true)
    expect(zonaInteractiva({ ...nada, sobreBoton: true })).toBe(true)
    expect(zonaInteractiva({ ...nada, enCentro: true })).toBe(true)
  })
})
