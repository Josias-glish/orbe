import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ATAJO_LEER_POR_DEFECTO,
  ATAJO_PANEL_POR_DEFECTO,
  CONTEXTO_MAX_POR_DEFECTO,
  ESFUERZO_POR_DEFECTO,
  MEMORIA_MAX_POR_DEFECTO,
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

describe('resolverConfig: contexto de pantalla y atajos', () => {
  it('por defecto: 8000 caracteres de contexto y los atajos de siempre', () => {
    const c = resolverConfig({}, {})
    expect(c.contextoMax).toBe(CONTEXTO_MAX_POR_DEFECTO)
    expect(c.contextoMax).toBe(8000)
    expect(c.atajoPanel).toBe(ATAJO_PANEL_POR_DEFECTO)
    expect(c.atajoLeer).toBe(ATAJO_LEER_POR_DEFECTO)
    expect(c.avisos).toEqual([])
  })

  it('lee ORBE_CONTEXTO_MAX y los atajos del .env', () => {
    const c = resolverConfig({ ORBE_CONTEXTO_MAX: '12000', ORBE_ATAJO_PANEL: 'Ctrl+Alt+O', ORBE_ATAJO_LEER: 'Ctrl+Alt+L' }, {})
    expect(c.contextoMax).toBe(12000)
    expect(c.atajoPanel).toBe('Ctrl+Alt+O')
    expect(c.atajoLeer).toBe('Ctrl+Alt+L')
  })

  it.each(['abc', '100', '499', '60001', '8000.5', '-5'])('ORBE_CONTEXTO_MAX=%s es inválido: avisa y usa el valor por defecto', (v) => {
    const c = resolverConfig({ ORBE_CONTEXTO_MAX: v }, {})
    expect(c.contextoMax).toBe(CONTEXTO_MAX_POR_DEFECTO)
    expect(c.avisos).toHaveLength(1)
    expect(c.avisos[0]).toContain('ORBE_CONTEXTO_MAX')
  })

  it.each(['500', '60000'])('ORBE_CONTEXTO_MAX=%s está en el límite y vale', (v) => {
    expect(resolverConfig({ ORBE_CONTEXTO_MAX: v }, {}).contextoMax).toBe(Number(v))
  })
})

describe('resolverConfig: memoria', () => {
  it('por defecto: 6000 caracteres de recuerdos y la memoria de Claude Code como origen', () => {
    const c = resolverConfig({}, {})
    expect(c.memoriaMax).toBe(MEMORIA_MAX_POR_DEFECTO)
    expect(c.memoriaMax).toBe(6000)
    expect(c.memoriaOrigenes).toBeNull()
  })

  it('lee ORBE_MEMORIA_MAX del .env', () => {
    expect(resolverConfig({ ORBE_MEMORIA_MAX: '9000' }, {}).memoriaMax).toBe(9000)
    expect(resolverConfig({ ORBE_MEMORIA_MAX: '1000' }, {}).memoriaMax).toBe(1000)
    expect(resolverConfig({ ORBE_MEMORIA_MAX: '12000' }, {}).memoriaMax).toBe(12000)
  })

  it.each(['abc', '999', '12001', '6000.5', '-1'])('ORBE_MEMORIA_MAX=%s es inválido: avisa y usa el valor por defecto', (v) => {
    const c = resolverConfig({ ORBE_MEMORIA_MAX: v }, {})
    expect(c.memoriaMax).toBe(MEMORIA_MAX_POR_DEFECTO)
    expect(c.avisos).toHaveLength(1)
    expect(c.avisos[0]).toContain('ORBE_MEMORIA_MAX')
  })

  it('ORBE_MEMORIA_CLAUDE admite varias carpetas separadas por «;» y «ninguna» para no importar', () => {
    expect(resolverConfig({ ORBE_MEMORIA_CLAUDE: 'C:\\a\\memory; D:\\b\\memory ;;' }, {}).memoriaOrigenes).toEqual(['C:\\a\\memory', 'D:\\b\\memory'])
    for (const v of ['ninguna', 'NONE', 'off', 'ninguno']) {
      expect(resolverConfig({ ORBE_MEMORIA_CLAUDE: v }, {}).memoriaOrigenes).toEqual([])
    }
  })
})

describe('resolverConfig: modo agente', () => {
  it('por defecto el agente está activo, con 15 pasos, 5 búsquedas y sin permiso para la red local', () => {
    expect(resolverConfig({}, {}).agente).toEqual({ activo: true, pasos: 15, busquedaMax: 5, permitirLocal: false })
  })

  it('ORBE_AGENTE=0 (o no, off, false) lo apaga y auto/1/sí lo deja activo', () => {
    for (const v of ['0', 'no', 'OFF', 'false']) expect(resolverConfig({ ORBE_AGENTE: v }, {}).agente.activo).toBe(false)
    for (const v of ['auto', '1', 'sí', 'si', 'on', 'true']) expect(resolverConfig({ ORBE_AGENTE: v }, {}).agente.activo).toBe(true)
  })

  it('un ORBE_AGENTE que no se entiende deja el agente activo y avisa', () => {
    const c = resolverConfig({ ORBE_AGENTE: 'quizás' }, {})
    expect(c.agente.activo).toBe(true)
    expect(c.avisos.some((a) => a.includes('ORBE_AGENTE'))).toBe(true)
  })

  it('ORBE_AGENTE_PASOS acepta de 1 a 25 y avisa con lo demás', () => {
    expect(resolverConfig({ ORBE_AGENTE_PASOS: '8' }, {}).agente.pasos).toBe(8)
    expect(resolverConfig({ ORBE_AGENTE_PASOS: '25' }, {}).agente.pasos).toBe(25)
    for (const v of ['0', '26', '3.5', 'muchos']) {
      const c = resolverConfig({ ORBE_AGENTE_PASOS: v }, {})
      expect(c.agente.pasos).toBe(15)
      expect(c.avisos.some((a) => a.includes('ORBE_AGENTE_PASOS'))).toBe(true)
    }
  })

  it('ORBE_BUSQUEDA_MAX acepta de 0 (apagada) a 10 y avisa con lo demás', () => {
    expect(resolverConfig({ ORBE_BUSQUEDA_MAX: '3' }, {}).agente.busquedaMax).toBe(3)
    expect(resolverConfig({ ORBE_BUSQUEDA_MAX: '0' }, {}).agente.busquedaMax).toBe(0)
    for (const v of ['11', '-1', 'x']) {
      const c = resolverConfig({ ORBE_BUSQUEDA_MAX: v }, {})
      expect(c.agente.busquedaMax).toBe(5)
      expect(c.avisos.some((a) => a.includes('ORBE_BUSQUEDA_MAX'))).toBe(true)
    }
  })

  it('ORBE_PERMITIR_LOCAL solo se enciende si se pide con claridad', () => {
    expect(resolverConfig({ ORBE_PERMITIR_LOCAL: '1' }, {}).agente.permitirLocal).toBe(true)
    expect(resolverConfig({ ORBE_PERMITIR_LOCAL: 'no' }, {}).agente.permitirLocal).toBe(false)
    const c = resolverConfig({ ORBE_PERMITIR_LOCAL: 'tal vez' }, {})
    expect(c.agente.permitirLocal).toBe(false)
    expect(c.avisos.some((a) => a.includes('ORBE_PERMITIR_LOCAL'))).toBe(true)
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
