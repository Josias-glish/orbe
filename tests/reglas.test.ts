import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Politica } from '../src/main/agente/politica'
import { asegurarReglas, decisionPorRegla, leerReglas, MINIMO, modoDe, pedidoExplicito, REGLAS_POR_DEFECTO } from '../src/main/agente/reglas'
import { definirHerramienta, type Herramienta } from '../src/main/agente/tipos'

describe('modoDe', () => {
  it('lo desconocido se pregunta', () => {
    expect(modoDe('algo.nuevo', {})).toBe('preguntar')
  })

  it('los mínimos no se pueden relajar desde reglas.json', () => {
    expect(modoDe('ig.publicar', { 'ig.publicar': 'libre' })).toBe('preguntar')
    expect(modoDe('ig.responder_mensaje', { 'ig.responder_mensaje': 'si_lo_pediste' })).toBe('preguntar')
    expect(modoDe('navegador.comprar', { 'navegador.comprar': 'libre' })).toBe('bloqueado')
    expect(modoDe('ig.seguir', { 'ig.seguir': 'libre' })).toBe('bloqueado')
    expect(modoDe('gmail.enviar', { 'gmail.enviar': 'preguntar' })).toBe('bloqueado')
  })

  it('pero sí se pueden endurecer', () => {
    expect(modoDe('ig.publicar', { 'ig.publicar': 'tu_lo_haces' })).toBe('tu_lo_haces')
    expect(modoDe('gmail.leer', { 'gmail.leer': 'preguntar' })).toBe('preguntar')
  })

  it('una clave heredada del prototipo no cuenta como regla', () => {
    expect(modoDe('constructor', {})).toBe('preguntar')
  })

  it('las reglas por defecto respetan los mínimos', () => {
    // Ninguna regla por defecto queda por debajo de su mínimo (si lo estuviera, modoDe la subiría).
    for (const [accion, modo] of Object.entries(REGLAS_POR_DEFECTO)) expect(modoDe(accion, REGLAS_POR_DEFECTO)).toBe(modo)
    for (const accion of Object.keys(MINIMO)) expect(modoDe(accion, REGLAS_POR_DEFECTO)).not.toBe('libre')
  })
})

describe('pedidoExplicito y decisionPorRegla', () => {
  it('«si_lo_pediste» solo vale con tu orden', () => {
    expect(pedidoExplicito('gmail.borrador', 'Redacta un borrador para Ana')).toBe(true)
    expect(pedidoExplicito('gmail.borrador', 'Resume mi correo de hoy')).toBe(false)
    expect(pedidoExplicito('gmail.borrador', undefined)).toBe(false)
    expect(decisionPorRegla('gmail.borrador', 'si_lo_pediste', 't', 'responde a Ana').tipo).toBe('permitir')
    expect(decisionPorRegla('gmail.borrador', 'si_lo_pediste', 't', 'resume mi correo').tipo).toBe('confirmar')
  })

  it('cada modo se traduce en su decisión', () => {
    expect(decisionPorRegla('a.b', 'libre', 't').tipo).toBe('permitir')
    expect(decisionPorRegla('a.b', 'preguntar', 't').tipo).toBe('confirmar')
    const tuyo = decisionPorRegla('a.b', 'tu_lo_haces', 't')
    expect(tuyo.tipo === 'prohibir' && /te lo dejo preparado/i.test(tuyo.motivo)).toBe(true)
    expect(decisionPorRegla('a.b', 'bloqueado', 't').tipo).toBe('prohibir')
  })
})

describe('Politica con reglas', () => {
  const herramienta = (accion: string | undefined, propia?: Herramienta['clasificar']): Herramienta =>
    definirHerramienta<unknown>({
      nombre: 'prueba',
      descripcion: 'prueba',
      esquema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      nivel: 'libre',
      ...(accion ? { accion } : {}),
      ...(propia ? { clasificar: propia } : {}),
      validar: (e) => ({ ok: true, valor: e }),
      describir: () => 'prueba',
      ejecutar: async () => ({ texto: '' })
    })

  it('una herramienta sin acción de conector sigue como antes', () => {
    expect(new Politica().decidir(herramienta(undefined), {}, 't').tipo).toBe('permitir')
  })

  it('ig.publicar pide permiso aunque reglas.json diga «libre»', () => {
    const p = new Politica({ reglas: { 'ig.publicar': 'libre' } })
    expect(p.decidir(herramienta('ig.publicar'), {}, 'Publicar').tipo).toBe('confirmar')
  })

  it('la herramienta puede endurecer la regla, nunca relajarla', () => {
    const p = new Politica({ reglas: { 'ig.leer': 'libre' } })
    expect(p.decidir(herramienta('ig.leer', () => ({ tipo: 'prohibir', motivo: 'no' })), {}, 't').tipo).toBe('prohibir')
    const q = new Politica({ reglas: { 'ig.publicar': 'preguntar' } })
    expect(q.decidir(herramienta('ig.publicar', () => ({ tipo: 'permitir' })), {}, 't').tipo).toBe('confirmar')
  })

  it('en modo vigilado, lo libre también pregunta', () => {
    const p = new Politica({ reglas: { 'ig.leer': 'libre' } })
    p.vigilar()
    expect(p.decidir(herramienta('ig.leer'), {}, 't').tipo).toBe('confirmar')
  })
})

describe('reglas.json', () => {
  let carpeta: string
  let ruta: string
  beforeEach(() => {
    carpeta = mkdtempSync(join(tmpdir(), 'orbe-reglas-'))
    ruta = join(carpeta, 'reglas.json')
  })
  afterEach(() => rmSync(carpeta, { recursive: true, force: true }))

  it('se crea con las reglas por defecto si no existe', () => {
    expect(asegurarReglas(ruta)).toBe(true)
    expect(leerReglas(ruta)).toEqual(REGLAS_POR_DEFECTO)
    expect(JSON.parse(readFileSync(ruta, 'utf8')).version).toBe(1)
  })

  it('si ya existe, no se toca', () => {
    writeFileSync(ruta, '{"version":1,"reglas":[{"accion":"ig.leer","modo":"preguntar"}]}')
    expect(asegurarReglas(ruta)).toBe(false)
    expect(readFileSync(ruta, 'utf8')).toContain('"preguntar"')
    expect(leerReglas(ruta)).toEqual({ 'ig.leer': 'preguntar' })
  })

  it('ignora entradas inválidas y, si el archivo está roto, usa las de por defecto', () => {
    writeFileSync(ruta, '﻿{"reglas":[{"accion":"ig.leer","modo":"siempre"},{"accion":"Mal Nombre","modo":"libre"},{"accion":"gmail.leer","modo":"libre"}]}')
    expect(leerReglas(ruta)).toEqual({ 'gmail.leer': 'libre' })
    writeFileSync(ruta, '{ roto')
    expect(leerReglas(ruta)).toEqual(REGLAS_POR_DEFECTO)
    expect(existsSync(ruta)).toBe(true)
  })
})
