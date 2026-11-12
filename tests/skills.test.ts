import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crearHerramientasAprender } from '../src/main/agente/herramientas/aprender'
import type { ContextoHerramienta } from '../src/main/agente/tipos'
import { AlmacenSkills } from '../src/main/skills/almacen'

const ctx = (aprobar: boolean): ContextoHerramienta =>
  ({ senal: new AbortController().signal, preguntar: async () => aprobar, vigilar: () => {}, permitirLocal: false }) as unknown as ContextoHerramienta

describe('skills propias y aprendizaje', () => {
  it('solo el índice viaja; se carga, se crea y se mejora con copia, y nada sin aprobación', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbe-skills-'))
    const skills = new AlmacenSkills(dir)
    expect(skills.indice()).toBeUndefined()
    mkdirSync(join(dir, 'Mala Skill'))
    writeFileSync(join(dir, 'Mala Skill', 'SKILL.md'), 'x')
    const recuerdos: string[] = []
    const [usar, proponer] = crearHerramientasAprender(skills, (t) => (recuerdos.push(t), { ok: true }))

    const args = { tipo: 'skill', nombre: 'reel-morfy', descripcion: 'Cómo hago los reels de morfy', contenido: 'Gancho en 2 s.' }
    expect((await proponer!.ejecutar(args, ctx(false))).texto).toMatch(/no quiso/)
    expect(skills.listar()).toEqual([])
    expect((await proponer!.ejecutar(args, ctx(true))).texto).toMatch(/creada/)
    expect(skills.indice()).toContain('- reel-morfy: Cómo hago los reels de morfy')
    expect(skills.indice()).not.toContain('Gancho')
    expect((await usar!.ejecutar({ nombre: 'reel-morfy' }, ctx(true))).texto).toContain('Gancho en 2 s.')

    expect((await proponer!.ejecutar({ ...args, contenido: 'Gancho en 1 s.' }, ctx(true))).texto).toMatch(/mejorada/)
    expect(readdirSync(join(dir, 'reel-morfy')).filter((f) => f.startsWith('anterior-'))).toHaveLength(1)
    expect(skills.leer('reel-morfy')?.cuerpo).toBe('Gancho en 1 s.')

    expect((await proponer!.ejecutar({ tipo: 'skill', nombre: '../fuera', descripcion: 'x', contenido: 'y' }, ctx(true))).texto).toMatch(/nombre válido/)
    await proponer!.ejecutar({ tipo: 'recuerdo', descripcion: 'Preferencia', contenido: 'Prefiere pies cortos' }, ctx(true))
    expect(recuerdos).toEqual(['Prefiere pies cortos'])
  })
})
