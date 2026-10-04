import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ESFUERZO_POR_DEFECTO,
  MODELO_POR_DEFECTO,
  leerArchivosEnv,
  nombreLegibleModelo,
  parsearEnv,
  resolverConfig
} from '../src/main/entorno'

describe('parsearEnv', () => {
  it('lee claves, comillas, comentarios y export', () => {
    const texto = [
      '# comentario',
      '',
      'ANTHROPIC_API_KEY=sk-ant-123',
      'ORBE_MODELO = "claude-opus-5-5"',
      "RUTA='C:\\Users\\yo\\claude.exe'",
      'export ORBE_ESFUERZO=low   # al final',
      'MAL FORMADA',
      '=sinclave'
    ].join('\r\n')
    expect(parsearEnv(texto)).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-123',
      ORBE_MODELO: 'claude-opus-5-5',
      RUTA: 'C:\\Users\\yo\\claude.exe',
      ORBE_ESFUERZO: 'low'
    })
  })

  it('un valor vacío es una cadena vacía', () => {
    expect(parsearEnv('ANTHROPIC_API_KEY=')).toEqual({ ANTHROPIC_API_KEY: '' })
  })

  it('una almohadilla pegada al valor no es un comentario', () => {
    expect(parsearEnv('CLAVE=abc#def')).toEqual({ CLAVE: 'abc#def' })
  })
})

describe('leerArchivosEnv', () => {
  it('combina archivos y gana el primero; ignora los que no existen', () => {
    const carpeta = mkdtempSync(join(tmpdir(), 'orbe-env-'))
    const a = join(carpeta, 'a.env')
    const b = join(carpeta, 'b.env')
    writeFileSync(a, 'X=desde-a\nSOLO_A=1')
    writeFileSync(b, 'X=desde-b\nSOLO_B=2')
    const lectura = leerArchivosEnv([join(carpeta, 'no-existe.env'), a, b])
    expect(lectura.valores).toEqual({ X: 'desde-a', SOLO_A: '1', SOLO_B: '2' })
    expect(lectura.usados).toEqual([a, b])
  })
})

describe('resolverConfig', () => {
  it('por defecto usa el CLI con Sonnet 5.5 y esfuerzo medio', () => {
    const c = resolverConfig({}, {})
    expect(c.proveedor).toBe('cli')
    expect(c.modelo).toBe(MODELO_POR_DEFECTO)
    expect(c.modelo).toBe('claude-sonnet-5-5')
    expect(c.esfuerzo).toBe(ESFUERZO_POR_DEFECTO)
    expect(c.apiKey).toBe('')
    expect(c.avisos).toEqual([])
  })

  it('con una API key en el .env pasa a la API automáticamente', () => {
    const c = resolverConfig({ ANTHROPIC_API_KEY: 'sk-ant-1' }, {})
    expect(c.proveedor).toBe('api')
    expect(c.apiKey).toBe('sk-ant-1')
  })

  it('una API key solo en el entorno del proceso no cambia de proveedor por sorpresa', () => {
    const c = resolverConfig({}, { ANTHROPIC_API_KEY: 'sk-ant-global' })
    expect(c.proveedor).toBe('cli')
    expect(c.apiKey).toBe('')
  })

  it('ORBE_PROVEEDOR=cli manda aunque haya clave, y no la expone', () => {
    const c = resolverConfig({ ANTHROPIC_API_KEY: 'sk-ant-1', ORBE_PROVEEDOR: 'cli' }, {})
    expect(c.proveedor).toBe('cli')
    expect(c.apiKey).toBe('')
  })

  it('ORBE_PROVEEDOR=api acepta la clave del entorno del proceso', () => {
    const c = resolverConfig({ ORBE_PROVEEDOR: 'api' }, { ANTHROPIC_API_KEY: 'sk-ant-global' })
    expect(c.proveedor).toBe('api')
    expect(c.apiKey).toBe('sk-ant-global')
  })

  it('lee modelo, esfuerzo y ruta del CLI; el .env gana al entorno', () => {
    const c = resolverConfig(
      { ORBE_MODELO: 'claude-opus-5-5', ORBE_ESFUERZO: 'HIGH', CLAUDE_CLI_PATH: 'C:\\x\\claude.exe' },
      { ORBE_MODELO: 'otro' }
    )
    expect(c.modelo).toBe('claude-opus-5-5')
    expect(c.esfuerzo).toBe('high')
    expect(c.rutaCli).toBe('C:\\x\\claude.exe')
  })

  it('un esfuerzo o proveedor inválido avisa y usa el valor por defecto', () => {
    const c = resolverConfig({ ORBE_ESFUERZO: 'enorme', ORBE_PROVEEDOR: 'nube' }, {})
    expect(c.esfuerzo).toBe(ESFUERZO_POR_DEFECTO)
    expect(c.proveedor).toBe('cli')
    expect(c.avisos).toHaveLength(2)
  })
})

describe('nombreLegibleModelo', () => {
  it.each([
    ['claude-sonnet-5-5', 'Sonnet 5.5'],
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-sonnet-5', 'Sonnet 5'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
    ['un-modelo-raro', 'un-modelo-raro']
  ])('%s → %s', (id, esperado) => {
    expect(nombreLegibleModelo(id)).toBe(esperado)
  })
})
