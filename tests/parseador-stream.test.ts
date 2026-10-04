import { describe, expect, it } from 'vitest'
import { LectorLineas, interpretarLinea } from '../src/main/chat/parseador-stream'

const linea = (obj: unknown): string => JSON.stringify(obj)

describe('LectorLineas', () => {
  it('devuelve solo líneas completas y guarda el resto para el siguiente trozo', () => {
    const lector = new LectorLineas()
    expect(lector.alimentar('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
    expect(lector.alimentar(':2}\n\n{"c":3}\n')).toEqual(['{"b":2}', '{"c":3}'])
  })

  it('tolera saltos de línea de Windows y líneas vacías', () => {
    const lector = new LectorLineas()
    expect(lector.alimentar('uno\r\n\r\ndos\r\n')).toEqual(['uno', 'dos'])
  })

  it('reiniciar descarta una línea a medias', () => {
    const lector = new LectorLineas()
    lector.alimentar('{"incompleta"')
    lector.reiniciar()
    expect(lector.alimentar('{"nueva":1}\n')).toEqual(['{"nueva":1}'])
  })
})

describe('interpretarLinea', () => {
  it('ignora basura, JSON que no es un objeto y tipos desconocidos', () => {
    expect(interpretarLinea('esto no es json')).toEqual([])
    expect(interpretarLinea('[1,2]')).toEqual([])
    expect(interpretarLinea('"texto"')).toEqual([])
    expect(interpretarLinea(linea({ type: 'algo_nuevo' }))).toEqual([])
    expect(interpretarLinea(linea({ type: 'system', subtype: 'post_turn_summary' }))).toEqual([])
  })

  it('reconoce el inicio de sesión', () => {
    expect(interpretarLinea(linea({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' }))).toEqual([
      { k: 'inicio' }
    ])
  })

  it('extrae los fragmentos de texto del streaming', () => {
    const ev = {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '¡Hola,' } }
    }
    expect(interpretarLinea(linea(ev))).toEqual([{ k: 'texto', delta: '¡Hola,' }])
  })

  it('no emite nada para fragmentos de texto vacíos ni para eventos de bloque sin interés', () => {
    const vacio = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '' } } }
    const inicioTexto = { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: '' } } }
    const fin = { type: 'stream_event', event: { type: 'message_stop' } }
    expect(interpretarLinea(linea(vacio))).toEqual([])
    expect(interpretarLinea(linea(inicioTexto))).toEqual([])
    expect(interpretarLinea(linea(fin))).toEqual([])
  })

  it('detecta que el modelo está pensando', () => {
    const inicio = { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking' } } }
    const delta = { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '…' } } }
    expect(interpretarLinea(linea(inicio))).toEqual([{ k: 'pensando' }])
    expect(interpretarLinea(linea(delta))).toEqual([{ k: 'pensando' }])
  })

  it('devuelve el mensaje completo del asistente como respaldo', () => {
    const ev = {
      type: 'assistant',
      message: { model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Hola' }, { type: 'text', text: 'mundo' }] }
    }
    expect(interpretarLinea(linea(ev))).toEqual([{ k: 'mensaje_completo', texto: 'Hola\n\nmundo' }])
  })

  it('un mensaje sintético con código de error es un error, no texto de la respuesta', () => {
    const ev = {
      type: 'assistant',
      error: 'authentication_failed',
      message: { model: '<synthetic>', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] }
    }
    expect(interpretarLinea(linea(ev))).toEqual([
      { k: 'error_mensaje', codigo: 'authentication_failed', texto: 'Not logged in · Please run /login' }
    ])
  })

  it('ignora mensajes sintéticos sin error', () => {
    const ev = { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'x' }] } }
    expect(interpretarLinea(linea(ev))).toEqual([])
  })

  it('interpreta los reintentos de la API (sin estado HTTP = sin conexión)', () => {
    const ev = { type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, retry_delay_ms: 1195, error_status: null, error: 'unknown' }
    expect(interpretarLinea(linea(ev))).toEqual([
      { k: 'reintento', intento: 2, maximo: 10, estadoHttp: null, error: 'unknown' }
    ])
  })

  it('interpreta los avisos de límite de uso', () => {
    const ev = {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', resetsAt: 1791111000, rateLimitType: 'five_hour' }
    }
    expect(interpretarLinea(linea(ev))).toEqual([
      { k: 'limite', estado: 'rejected', reinicioSeg: 1791111000, tipo: 'five_hour' }
    ])
  })

  it('interpreta un resultado correcto', () => {
    const ev = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      stop_reason: 'end_turn',
      terminal_reason: 'completed',
      api_error_status: null,
      result: '¡Hola!'
    }
    expect(interpretarLinea(linea(ev))).toEqual([
      { k: 'resultado', error: false, terminal: 'completed', parada: 'end_turn', estadoHttp: null, texto: '¡Hola!' }
    ])
  })

  it('interpreta un resultado interrumpido por el usuario', () => {
    const ev = { type: 'result', subtype: 'error_during_execution', is_error: true, stop_reason: null, terminal_reason: 'aborted_streaming' }
    expect(interpretarLinea(linea(ev))).toEqual([
      { k: 'resultado', error: true, terminal: 'aborted_streaming', parada: null, estadoHttp: null, texto: '' }
    ])
  })

  it('interpreta un resultado de error de la API con estado HTTP', () => {
    const ev = { type: 'result', is_error: true, terminal_reason: 'api_error', api_error_status: 429, result: 'limit' }
    expect(interpretarLinea(linea(ev))).toEqual([
      { k: 'resultado', error: true, terminal: 'api_error', parada: null, estadoHttp: 429, texto: 'limit' }
    ])
  })
})
