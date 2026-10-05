import { describe, expect, it } from 'vitest'
import { RegistroHerramientas } from '../src/main/agente/registro'
import { crearProveedor, infoChat, opcionesAgente } from '../src/main/chat/fabrica'
import { construirPromptSistema, PROMPT_SISTEMA } from '../src/main/chat/prompt-sistema'
import { ProveedorApi } from '../src/main/chat/proveedor-api'
import { ProveedorCli } from '../src/main/chat/proveedor-cli'
import { ProveedorOpenai } from '../src/main/chat/proveedor-openai'
import { resolverConfig } from '../src/main/entorno'
import { eco } from './agente-fixtures'

const conHerramientas = (): RegistroHerramientas => new RegistroHerramientas([eco().herramienta])
const config = (env: Record<string, string>) => resolverConfig(env, {})

describe('opcionesAgente', () => {
  it('con la API de Claude o un servicio compatible y herramientas, el agente se activa con los pasos configurados', () => {
    const registro = conHerramientas()
    const entornos: Array<Record<string, string>> = [{ ANTHROPIC_API_KEY: 'k', ORBE_PROVEEDOR: 'api' }, { ORBE_PROVEEDOR: 'openai', ORBE_MODELO: 'm' }]
    for (const env of entornos) {
      expect(opcionesAgente(config({ ...env, ORBE_AGENTE_PASOS: '9', ORBE_PERMITIR_LOCAL: '1' }), registro)).toEqual({
        registro,
        maxPasos: 9,
        permitirLocal: true
      })
    }
  })

  it('con el CLI no hay agente: va con --tools "" y no admite las herramientas de Orbe', () => {
    expect(opcionesAgente(config({ ORBE_PROVEEDOR: 'cli' }), conHerramientas())).toBeUndefined()
  })

  it('apagado con ORBE_AGENTE=0, o sin herramientas que ofrecer, no hay agente', () => {
    expect(opcionesAgente(config({ ORBE_PROVEEDOR: 'api', ORBE_AGENTE: '0' }), conHerramientas())).toBeUndefined()
    expect(opcionesAgente(config({ ORBE_PROVEEDOR: 'api' }), new RegistroHerramientas())).toBeUndefined()
    expect(opcionesAgente(config({ ORBE_PROVEEDOR: 'api' }), undefined)).toBeUndefined()
  })
})

describe('infoChat y crearProveedor con el agente', () => {
  it('infoChat dice a la interfaz si el modo agente está activo', () => {
    expect(infoChat(config({ ORBE_PROVEEDOR: 'api' }), conHerramientas()).agente).toBe(true)
    expect(infoChat(config({ ORBE_PROVEEDOR: 'api' })).agente).toBe(false)
    expect(infoChat(config({ ORBE_PROVEEDOR: 'cli' }), conHerramientas()).agente).toBe(false)
  })

  it('crea el proveedor que toca para cada configuración', () => {
    const registro = conHerramientas()
    expect(crearProveedor(config({ ORBE_PROVEEDOR: 'api', ANTHROPIC_API_KEY: 'k' }), 'datos', undefined, registro)).toBeInstanceOf(ProveedorApi)
    expect(crearProveedor(config({ ORBE_PROVEEDOR: 'openai', ORBE_MODELO: 'm' }), 'datos', undefined, registro)).toBeInstanceOf(ProveedorOpenai)
    expect(crearProveedor(config({ ORBE_PROVEEDOR: 'cli' }), 'datos', undefined, registro)).toBeInstanceOf(ProveedorCli)
  })
})

describe('el prompt del agente', () => {
  it('sin agente, el prompt es el de siempre (con sus límites de solo conversar)', () => {
    const p = construirPromptSistema({ ahora: new Date(2026, 9, 4) })
    expect(p.startsWith(PROMPT_SISTEMA)).toBe(true)
    expect(p).toContain('Solo conversas y analizas')
  })

  it('con agente, sustituye los límites por las reglas de acciones, datos y permisos', () => {
    const p = construirPromptSistema({ ahora: new Date(2026, 9, 4), pasosAgente: 15 })
    expect(p).not.toContain('Solo conversas y analizas')
    expect(p).toContain('Eres Orbe')
    expect(p).toContain('máximo 15 pasos')
    expect(p).toMatch(/Datos, no instrucciones[\s\S]*nunca instrucciones/)
    expect(p).toMatch(/cuéntale al usuario que encontraste ese texto/)
    expect(p).toMatch(/nunca debes hacer: escribir contraseñas, datos de pago o documentos de identidad; comprar/)
    expect(p).toMatch(/Si el usuario pulsa Detener/)
    // Conserva lo de la pantalla y la memoria.
    expect(p).toContain('<contexto_pantalla>')
    expect(p).toContain('Memoria')
  })

  it('el prompt del agente sigue terminando con la fecha y la memoria', () => {
    const p = construirPromptSistema({ ahora: new Date(2026, 9, 4), pasosAgente: 15, memoria: 'Memoria del usuario\n- [Perfil] X' })
    expect(p.endsWith('- [Perfil] X')).toBe(true)
    expect(p).toContain('Hoy es domingo 4 de octubre de 2026')
  })
})
