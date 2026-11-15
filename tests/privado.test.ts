import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, ipcMain: { handle: vi.fn() } }))

import { ProveedorConmutable } from '../src/main/chat/privado'
import type { ProveedorChat } from '../src/main/chat/proveedor'
import { resolverConfig } from '../src/main/entorno'
import { ServicioVision } from '../src/main/vision/servicio'

const falso = (nombre: ProveedorChat['nombre'], modelo: string) =>
  ({ nombre, modelo, enviar: vi.fn(async () => ({ motivo: 'completo' as const })), cancelar: vi.fn(), reiniciar: vi.fn(), cerrar: vi.fn() }) satisfies ProveedorChat

describe('🔒 Privado', () => {
  it('con el interruptor, el turno va solo al modelo local; cada cambio empieza limpio', async () => {
    const profundo = falso('cli', 'sonnet')
    const local = falso('openai', 'llama3.2')
    const p = new ProveedorConmutable(profundo, local)
    await p.enviar({ texto: 'hola' }, { alTexto() {} })
    expect(profundo.enviar).toHaveBeenCalledTimes(1)
    p.fijarPrivado(true)
    expect(p).toMatchObject({ privado: true, nombre: 'openai', modelo: 'llama3.2' })
    expect(local.reiniciar).toHaveBeenCalledTimes(1)
    await p.enviar({ texto: 'secreto' }, { alTexto() {} })
    expect(local.enviar).toHaveBeenCalledTimes(1)
    expect(profundo.enviar).toHaveBeenCalledTimes(1)
    p.fijarPrivado(false)
    expect(local.cancelar).toHaveBeenCalled()
    expect(profundo.reiniciar).toHaveBeenCalledTimes(1)
  })

  it('Ollama solo en este PC: otra dirección se rechaza con aviso', () => {
    expect(resolverConfig({ ORBE_LOCAL_URL: 'http://127.0.0.1:11434/v1' }, {}).companero.url).toBe('http://127.0.0.1:11434')
    const c = resolverConfig({ ORBE_LOCAL_URL: 'http://0.0.0.0:11434' }, {})
    expect(c.companero.url).toBe('http://127.0.0.1:11434')
    expect(c.avisos.join(' ')).toContain('ORBE_LOCAL_URL')
  })
})

describe('ojos del Compañero en la nube', () => {
  const crear = (dir: string, proveedor: 'ollama' | 'claude-cli', companeroNube: boolean) =>
    new ServicioVision({
      config: { proveedor, modelo: 'm', baseUrl: '', maxDia: 5 },
      clave: () => undefined,
      archivoConsentimiento: join(dir, 'consentimientos.json'),
      archivoUso: null,
      rutaCli: 'claude',
      companeroNube
    })

  it('con Ollama basta el permiso de la visión', () => {
    const s = crear(mkdtempSync(join(tmpdir(), 'orbe-ojos-')), 'ollama', false)
    s.consentir()
    expect(s.estado().companero).toBe('local')
    expect(s.ojosCompanero()).toBe(true)
  })

  it('en la nube hace falta ORBE_COMPANERO_OJOS_NUBE y un segundo permiso para ese proveedor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbe-ojos-'))
    const sinVariable = crear(dir, 'claude-cli', false)
    sinVariable.consentir()
    expect(sinVariable.consentirCompanero().companero).toBe('apagado')
    expect(sinVariable.ojosCompanero()).toBe(false)
    const s = crear(dir, 'claude-cli', true)
    expect(s.estado()).toMatchObject({ activa: true, companero: 'falta_permiso' })
    expect(s.ojosCompanero()).toBe(false)
    expect(s.consentirCompanero().companero).toBe('permitido')
    expect(s.ojosCompanero()).toBe(true)
    const guardado = JSON.parse(readFileSync(join(dir, 'consentimientos.json'), 'utf8'))
    expect(guardado.vision.version).toBe(1)
    expect(guardado.companero.proveedor).toBe('claude-cli')
  })
})
