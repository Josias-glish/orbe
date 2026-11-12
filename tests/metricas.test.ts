import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ServicioMetricas, cambioDesde, tasaInteraccion } from '../src/main/metricas/servicio'
import { instagramDemo } from '../src/main/metricas/demo'
import { crearHerramientaCrecimiento } from '../src/main/agente/herramientas/metricas'

const archivo = (): string => join(mkdtempSync(join(tmpdir(), 'orbe-metricas-')), 'metricas.json')

describe('métricas', () => {
  it('tasa de interacción sobre el alcance, o sobre seguidores si no hay alcance', () => {
    expect(tasaInteraccion({ meGusta: 40, comentarios: 5, compartidos: 3, guardados: 2, alcance: 1000 }, 5000)).toBe(5)
    expect(tasaInteraccion({ meGusta: 40, comentarios: 10, interacciones: 60 }, 1200)).toBe(5)
    expect(tasaInteraccion({ meGusta: 1, comentarios: 0 }, 0)).toBeNull()
  })

  it('lee la cuenta, calcula medias y guarda un punto por día', async () => {
    let hoy = new Date(2026, 10, 10, 12)
    const ruta = archivo()
    const s = new ServicioMetricas(ruta, () => instagramDemo(), () => hoy)
    const i = await s.leer('morfy')
    expect(i.seguidores).toBe(1200)
    expect(i.publicaciones).toHaveLength(6)
    expect(i.medias.alcance).toBe(1750) // (6000 + 5 × 900) / 6
    expect(i.publicaciones[0].tasa).toBe(10.2) // 613 / 6000
    await s.leer('morfy') // mismo día: no duplica
    hoy = new Date(2026, 10, 18, 12)
    await s.leer('morfy')
    const guardado = JSON.parse(readFileSync(ruta, 'utf8')).historial.morfy
    expect(guardado.map((d: { fecha: string }) => d.fecha)).toEqual(['2026-11-10', '2026-11-18'])
    expect(new ServicioMetricas(ruta, () => instagramDemo()).historialDe('morfy')).toHaveLength(2)
  })

  it('si faltan las métricas detalladas, sigue con lo básico y explica por qué', async () => {
    const demo = instagramDemo()
    const s = new ServicioMetricas(null, () => ({ ...demo, metricas: async () => { throw new Error('falta instagram_manage_insights') } }))
    const i = await s.leer('personal')
    expect(i.avisoMetricas).toMatch(/instagram_manage_insights/)
    expect(i.medias.alcance).toBeNull()
    expect(i.publicaciones[0].tasa).toBeDefined() // sobre seguidores
  })

  it('crecimiento a 7 días con el punto más cercano anterior', () => {
    const h = [
      { fecha: '2026-11-01', seguidores: 1000 },
      { fecha: '2026-11-04', seguidores: 1010 },
      { fecha: '2026-11-11', seguidores: 1050 }
    ]
    expect(cambioDesde(h, 7, new Date(2026, 10, 11))).toBe(40)
    expect(cambioDesde(h, 30, new Date(2026, 10, 11))).toBe(50)
    expect(cambioDesde(h.slice(0, 1), 7, new Date(2026, 10, 11))).toBeNull()
  })

  it('ig_crecimiento compara cada publicación con la media y lo entrega como datos externos', async () => {
    const h = crearHerramientaCrecimiento(new ServicioMetricas(null, () => instagramDemo()))
    expect(h.accion).toBe('ig.leer')
    const v = h.validar({ cuenta: 'personal' })
    if (!v.ok) throw new Error(v.error)
    const r = await h.ejecutar(v.valor, { senal: new AbortController().signal } as never)
    expect(r.externo?.origen).toBe('Instagram')
    expect(r.texto).toContain('alcance 6000 (+243 %)')
    expect(r.texto).toContain('alcance 900 (-49 %)')
  })
})
