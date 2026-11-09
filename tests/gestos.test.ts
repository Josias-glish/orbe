import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({}))
import { GESTOS, IDS_GESTO, POSE_NEUTRA, gestoDeExpresion, poseGesto } from '../src/renderer/personaje/gestos'
import { Director, GESTO_OCIO_MAX_MS } from '../src/renderer/personaje/director'

describe('gestos', () => {
  it.each(IDS_GESTO)('«%s» empieza y termina en la pose neutra y no se desmadra', (id) => {
    for (const p of [0, 1]) {
      const pose = poseGesto(id, p)
      if (id === 'giro' && p === 1) expect(pose.rotY).toBeCloseTo(Math.PI * 2, 5) // una vuelta entera = de frente
      else expect(pose.rotY).toBeCloseTo(0, 5)
      expect(pose.rotX).toBeCloseTo(0, 5)
      expect(pose.posY).toBeCloseTo(0, 5)
      expect(pose.escalaY).toBeCloseTo(1, 5)
    }
    for (let p = 0; p <= 1; p += 0.05) {
      const pose = poseGesto(id, p)
      expect(Math.abs(pose.posY)).toBeLessThan(0.2)
      expect(pose.escalaY).toBeGreaterThan(0.8)
      expect(pose.escalaY).toBeLessThan(1.2)
    }
    expect(GESTOS[id].duracionMs).toBeGreaterThan(500)
  })

  it('el saludo enseña la mano solo mientras saluda', () => {
    expect(poseGesto('saludo', 0).mano).toBeNull()
    expect(poseGesto('saludo', 0.5).mano).not.toBeNull()
    expect(poseGesto('salto', 0.5).mano).toBeNull()
    expect(POSE_NEUTRA.mano).toBeNull()
  })

  it('cada cara alegre o triste tiene su gesto', () => {
    expect(gestoDeExpresion('orgulloso')).toBe('reverencia')
    expect(gestoDeExpresion('preocupado')).toBe('negar')
    expect(gestoDeExpresion('neutral')).toBeNull()
  })
})

describe('el director y los gestos', () => {
  it('en reposo hace gestos solos de vez en cuando, pero no dormido ni trabajando', () => {
    let t = 0
    const d = new Director(() => t, 10 * 60_000, () => undefined)
    expect(d.gestoActual()).toBeNull()
    t = GESTO_OCIO_MAX_MS + 1
    expect(d.gestoActual()).not.toBeNull()
    t += 10_000
    d.gestoActual()
    d.establecerEstado('pensando')
    t += GESTO_OCIO_MAX_MS + 1
    expect(d.gestoActual()).toBeNull()
    d.establecerEstado('reposo')
    d.reaccionar('ausente')
    t += GESTO_OCIO_MAX_MS + 1
    expect(d.gestoActual()).toBeNull()
  })

  it('saluda al volver y salta al abrir el panel; un gesto pedido con cara pone su expresión', () => {
    let t = 0
    const d = new Director(() => t, 10 * 60_000, () => undefined)
    d.reaccionar('ausente')
    d.reaccionar('vuelve')
    expect(d.gestoActual()?.id).toBe('saludo')
    expect(d.actual()).toBe('sorprendido') // la cara de la reacción se mantiene
    t += 5000
    d.reaccionar('abrir')
    expect(d.gestoActual()?.id).toBe('salto')
    t += 5000
    d.gesticular('baile', true)
    expect(d.actual()).toBe('emocionado')
    t += 1300
    expect(d.gestoActual()?.progreso).toBeCloseTo(0.5, 1)
  })
})
