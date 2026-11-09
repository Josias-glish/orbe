import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { estimarCoste, RegistroUso, tarifaDe } from '../src/main/uso/registro'
import { usoOpenai } from '../src/main/chat/proveedor-openai'
import { usoAnthropic } from '../src/main/chat/proveedor-api'

describe('tarifas', () => {
  it('encuentra la tarifa por prefijo y no confunde modelos parecidos', () => {
    expect(tarifaDe('claude-sonnet-5-5')?.entrada).toBe(2)
    expect(tarifaDe('claude-sonnet-4-5-20250929')?.entrada).toBe(3)
    expect(tarifaDe('claude-opus-5-5')?.entrada).toBe(4)
    expect(tarifaDe('claude-opus-5')?.entrada).toBe(5)
    expect(tarifaDe('gemini-3.5-flash')).toBeNull()
  })

  it('estima el coste con entrada, salida y caché', () => {
    // Sonnet 5.5: 2 $/M entrada, 10 $/M salida, 0,2 $/M lectura de caché, 2,5 $/M escritura.
    const c = estimarCoste('claude-sonnet-5-5', { entrada: 1_000_000, salida: 100_000, cacheLectura: 1_000_000, cacheEscritura: 0 })
    expect(c).toBeCloseTo(2 + 1 + 0.2, 6)
    expect(estimarCoste('gemini-3.5-flash', { entrada: 10, salida: 10 })).toBeNull()
  })
})

describe('RegistroUso', () => {
  it('suma por día y por modelo, usa el coste del CLI y marca lo que no tiene precio', () => {
    let t = new Date(2026, 10, 9, 12).getTime()
    const r = new RegistroUso(null, () => t)
    r.anotar('api', 'claude-sonnet-5-5', { entrada: 1000, salida: 500 })
    r.anotar('cli', 'claude-opus-5-5', { entrada: 10, salida: 20, costeUsd: 0.5 })
    r.anotar('openai', 'gemini-3.5-flash', { entrada: 100, salida: 200 })
    t += 2 * 86_400_000
    r.anotar('api', 'claude-sonnet-5-5', { entrada: 1000, salida: 0 })
    const s = r.resumen()
    expect(s.hoy.peticiones).toBe(1)
    expect(s.semana.peticiones).toBe(4)
    expect(s.total.costeUsd).toBeCloseTo(0.002 + 0.005 + 0.5 + 0.002, 6)
    expect(s.total.sinPrecio).toBe(true)
    expect(s.hoy.sinPrecio).toBe(false)
    expect(s.dias).toHaveLength(14)
    expect(s.dias[13].tokens).toBe(1000)
    expect(s.porModelo[0]).toMatchObject({ proveedor: 'cli', modelo: 'claude-opus-5-5', costeUsd: 0.5 })
  })

  it('guarda en disco y lo vuelve a leer; poner a cero lo borra', () => {
    const archivo = join(mkdtempSync(join(tmpdir(), 'orbe-uso-')), 'uso.json')
    const r = new RegistroUso(archivo)
    r.anotar('api', 'claude-haiku-5-5', { entrada: 10, salida: 10 })
    r.anotarLimite({ estado: 'allowed_warning', tipo: 'five_hour', reinicio: 123 })
    r.guardarAhora()
    expect(readFileSync(archivo, 'utf8')).not.toContain('hola')
    const otro = new RegistroUso(archivo)
    expect(otro.resumen().total.peticiones).toBe(1)
    expect(otro.resumen().limiteCli?.estado).toBe('allowed_warning')
    otro.borrar()
    expect(new RegistroUso(archivo).resumen().desde).toBeNull()
  })
})

describe('lectura del gasto que manda cada servicio', () => {
  it('OpenAI/Gemini: cuenta el razonamiento que solo aparece en el total y separa la caché', () => {
    expect(usoOpenai({ prompt_tokens: 3, completion_tokens: 15, total_tokens: 242 })).toEqual({ entrada: 3, salida: 239, cacheLectura: 0 })
    expect(usoOpenai({ prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_tokens_details: { cached_tokens: 60 } })).toEqual({
      entrada: 40,
      salida: 5,
      cacheLectura: 60
    })
  })

  it('Anthropic: tokens y caché', () => {
    expect(usoAnthropic({ input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 9, cache_creation_input_tokens: null })).toEqual({
      entrada: 5,
      salida: 7,
      cacheLectura: 9,
      cacheEscritura: 0
    })
  })
})
