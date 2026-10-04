import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { ErrorChat, crearError, describirReinicio, errorDesdeApi, errorDesdeCli } from '../src/main/chat/errores'

describe('describirReinicio', () => {
  const ahora = new Date('2026-10-04T10:00:00Z')

  it('usa «a las HH:MM» si el reinicio es hoy', () => {
    const reinicio = Date.parse('2026-10-04T15:30:00Z') / 1000
    expect(describirReinicio(reinicio, ahora, 'UTC')).toBe('a las 15:30')
  })

  it('añade el día de la semana si es otro día', () => {
    const reinicio = Date.parse('2026-10-06T09:05:00Z') / 1000
    expect(describirReinicio(reinicio, ahora, 'UTC')).toBe('el martes a las 09:05')
  })
})

describe('errorDesdeCli', () => {
  it('sin sesión iniciada', () => {
    const e = errorDesdeCli({ codigoCli: 'authentication_failed', texto: 'Not logged in · Please run /login' })
    expect(e.codigo).toBe('sin_sesion')
    expect(e.mensaje).toContain('/login')
    expect(e.detalle).toContain('authentication_failed')
  })

  it('límite de uso con la hora de reinicio', () => {
    const e = errorDesdeCli(
      { codigoCli: 'rate_limit', reinicioSeg: Date.parse('2026-10-04T17:00:00Z') / 1000 },
      new Date('2026-10-04T10:00:00Z')
    )
    expect(e.codigo).toBe('limite_uso')
    expect(e.mensaje).toMatch(/Se restablece (a las|el)/)
    expect(e.reintentable).toBe(true)
  })

  it('límite de uso sin hora conocida', () => {
    const e = errorDesdeCli({ codigoCli: 'rate_limit' })
    expect(e.codigo).toBe('limite_uso')
    expect(e.mensaje).toContain('Espera')
  })

  it('un aviso de límite rechazado convierte un error genérico en límite de uso', () => {
    const e = errorDesdeCli({ codigoCli: 'unknown', texto: 'algo', limiteRechazado: true })
    expect(e.codigo).toBe('limite_uso')
  })

  it.each([
    ['overloaded', 'sobrecarga'],
    ['server_error', 'sobrecarga'],
    ['invalid_request', 'solicitud_invalida'],
    ['model_not_found', 'modelo'],
    ['billing_error', 'cuenta'],
    ['account_on_hold', 'cuenta'],
    ['oauth_org_not_allowed', 'cuenta'],
    ['cloud_credential_error', 'cuenta']
  ])('el código del CLI %s se traduce a %s', (codigoCli, esperado) => {
    expect(errorDesdeCli({ codigoCli }).codigo).toBe(esperado)
  })

  it.each([
    [401, 'sin_sesion'],
    [402, 'cuenta'],
    [403, 'cuenta'],
    [404, 'modelo'],
    [429, 'limite_uso'],
    [400, 'solicitud_invalida'],
    [500, 'sobrecarga'],
    [529, 'sobrecarga']
  ])('el estado HTTP %i se traduce a %s cuando no hay código', (estadoHttp, esperado) => {
    expect(errorDesdeCli({ estadoHttp }).codigo).toBe(esperado)
  })

  it('un error sin pistas es «desconocido» y conserva el texto del CLI', () => {
    const e = errorDesdeCli({ texto: 'Algo raro', stderr: 'traza larga' })
    expect(e.codigo).toBe('desconocido')
    expect(e.mensaje).toContain('Algo raro')
    expect(e.detalle).toContain('traza larga')
  })
})

describe('errorDesdeApi', () => {
  const cabeceras = (obj: Record<string, string> = {}): Headers => new Headers(obj)

  it('conexión caída → sin conexión', () => {
    expect(errorDesdeApi(new Anthropic.APIConnectionError({ message: 'fetch failed' })).codigo).toBe('sin_conexion')
  })

  it('tiempo de espera agotado se distingue de una conexión caída', () => {
    expect(errorDesdeApi(new Anthropic.APIConnectionTimeoutError()).codigo).toBe('tiempo_agotado')
  })

  it('401 → API key no válida', () => {
    const e = Anthropic.APIError.generate(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key', cabeceras())
    const traducido = errorDesdeApi(e)
    expect(traducido.codigo).toBe('clave_invalida')
    expect(traducido.mensaje).toContain('ANTHROPIC_API_KEY')
    expect(traducido.reintentable).toBe(false)
  })

  it('403 → problema de permisos de la cuenta', () => {
    const e = Anthropic.APIError.generate(403, { error: { type: 'permission_error', message: 'no' } }, 'no', cabeceras())
    expect(errorDesdeApi(e).codigo).toBe('cuenta')
  })

  it('404 → modelo no disponible', () => {
    const e = Anthropic.APIError.generate(404, { error: { type: 'not_found_error', message: 'model: x' } }, 'model: x', cabeceras())
    expect(errorDesdeApi(e).codigo).toBe('modelo')
  })

  it('429 → límite de uso, con los segundos de retry-after', () => {
    const e = Anthropic.APIError.generate(429, { error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', cabeceras({ 'retry-after': '30' }))
    const traducido = errorDesdeApi(e)
    expect(traducido.codigo).toBe('limite_uso')
    expect(traducido.mensaje).toContain('30 segundos')
  })

  it('429 sin retry-after usa el mensaje genérico', () => {
    const e = Anthropic.APIError.generate(429, { error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', cabeceras())
    expect(errorDesdeApi(e).mensaje).toContain('Espera')
  })

  it('529 → saturación', () => {
    const e = Anthropic.APIError.generate(529, { error: { type: 'overloaded_error', message: 'Overloaded' } }, 'Overloaded', cabeceras())
    expect(errorDesdeApi(e).codigo).toBe('sobrecarga')
  })

  it('500 → saturación con mensaje de problemas del servidor', () => {
    const e = Anthropic.APIError.generate(500, { error: { type: 'api_error', message: 'oops' } }, 'oops', cabeceras())
    const traducido = errorDesdeApi(e)
    expect(traducido.codigo).toBe('sobrecarga')
    expect(traducido.mensaje).toContain('problemas')
  })

  it('400 → petición no válida con el mensaje de la API', () => {
    const e = Anthropic.APIError.generate(400, { error: { type: 'invalid_request_error', message: 'max_tokens too big' } }, 'max_tokens too big', cabeceras())
    const traducido = errorDesdeApi(e)
    expect(traducido.codigo).toBe('solicitud_invalida')
    expect(traducido.mensaje).toContain('max_tokens too big')
  })

  it('402 → problema de cuenta', () => {
    const e = Anthropic.APIError.generate(402, { error: { type: 'billing_error', message: 'pay' } }, 'pay', cabeceras())
    expect(errorDesdeApi(e).codigo).toBe('cuenta')
  })

  it('un error ya traducido pasa tal cual', () => {
    const original = crearError('rechazo')
    expect(errorDesdeApi(new ErrorChat(original))).toBe(original)
  })

  it('cualquier otra cosa es «desconocido» y conserva el mensaje', () => {
    const e = errorDesdeApi(new Error('explotó'))
    expect(e.codigo).toBe('desconocido')
    expect(e.detalle).toBe('explotó')
  })
})
