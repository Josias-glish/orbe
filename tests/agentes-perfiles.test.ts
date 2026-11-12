import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AlmacenAgentes, indiceAgentes, rutaPluginInstalado } from '../src/main/agentes/perfiles'
import { argumentosCli } from '../src/main/chat/proveedor-cli'

describe('agentes con nombre', () => {
  it('crea las plantillas una vez y solo da a cada agente las herramientas que Orbe ofrece', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'orbe-agentes-')), 'agentes')
    const a = new AlmacenAgentes(dir)
    expect(a.asegurarPlantillas()).toBe(true)
    expect(a.asegurarPlantillas()).toBe(false)
    expect(readdirSync(dir).sort()).toEqual(['_comun.md', 'contenido.md', 'correo.md', 'investigador.md', 'ventas.md'])
    writeFileSync(join(dir, 'correo.memoria.md'), 'Mi jefa es Ana.')
    writeFileSync(join(dir, 'Malo.md'), '---\nname: x\ndescription: y\n---\nz')

    // Sin Gmail conectado, Correo no aparece; sin búsqueda del CLI, el Investigador solo lee páginas.
    const defs = a.definiciones(new Set(['ig_perfil', 'buscar_memoria', 'ver_pagina']), false, 'America/Bogota')
    expect(Object.keys(defs).sort()).toEqual(['contenido', 'correo', 'investigador', 'ventas'])
    expect(defs['investigador']!.tools).toEqual(['mcp__orbe__ver_pagina', 'mcp__orbe__buscar_memoria'])
    expect(defs['correo']!.tools).toEqual(['mcp__orbe__buscar_memoria'])
    expect(defs['correo']!.prompt).toContain('Mi jefa es Ana.')
    expect(defs['correo']!.prompt).toContain('America/Bogota')
    expect(Object.keys(a.definiciones(new Set(), false))).toEqual([])
    expect(a.definiciones(new Set(['ver_pagina']), true)['investigador']!.tools).toEqual(['WebSearch', 'WebFetch', 'mcp__orbe__ver_pagina'])
    expect(indiceAgentes(defs)).toContain('- ventas:')
    expect(indiceAgentes({})).toBeUndefined()
  })

  it('con agentes, el CLI recibe --agents y la herramienta Agent; sin ellos, nada cambia', () => {
    const base = { configMcp: '{}', permitidas: ['mcp__orbe__x'], busquedaCli: false }
    const sin = argumentosCli('sonnet', 'medium', 'p', base)
    expect(sin[sin.indexOf('--tools') + 1]).toBe('')
    expect(sin).not.toContain('--agents')
    const con = argumentosCli('sonnet', 'medium', 'p', { ...base, agentes: '{"a":{}}' })
    expect(con[con.indexOf('--tools') + 1]).toBe('Agent')
    expect(con[con.indexOf('--agents') + 1]).toBe('{"a":{}}')
  })
})

describe('plugin ECC', () => {
  it('encuentra la ruta del plugin instalado, o null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbe-plug-'))
    const archivo = join(dir, 'installed_plugins.json')
    writeFileSync(archivo, JSON.stringify({ plugins: { 'ecc@ecc': [{ installPath: dir }] } }))
    expect(rutaPluginInstalado('ecc@ecc', archivo)).toBe(dir)
    expect(rutaPluginInstalado('otro@x', archivo)).toBeNull()
    expect(rutaPluginInstalado('ecc@ecc', join(dir, 'no.json'))).toBeNull()
  })
})
