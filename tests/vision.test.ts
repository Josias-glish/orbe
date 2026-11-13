import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ desktopCapturer: { getSources: vi.fn() } }))

import { detallePantalla, validarPantalla } from '../src/shared/vision'
import { describirImagen } from '../src/main/vision/proveedores'
import { ServicioVision, type ConfigVision } from '../src/main/vision/servicio'
import { casiNegra, ventanaPermitida } from '../src/main/vision/ojos'

const BUENA = JSON.stringify({ sensible: false, actividad: 'disenando', app: 'Canva', que_se_ve: 'Un póster.', titulo_obra: '', textos_visibles: ['Rebajas'] })

describe('validarPantalla', () => {
  it('acepta el JSON del prompt (también dentro de ```json) y rechaza lo que no cumple', () => {
    expect(validarPantalla('```json\n' + BUENA + '\n```')?.app).toBe('Canva')
    expect(validarPantalla(BUENA.replace('disenando', 'hackeando'))).toBeNull()
    expect(validarPantalla('no sé')).toBeNull()
  })
  it('el detalle enseña cada parte en su línea y omite las vacías', () => {
    const d = validarPantalla(BUENA)!
    expect(detallePantalla('Google Chrome', d).split('\n')).toEqual([
      'Ventana: Google Chrome (Canva)', 'Actividad: Diseñando', 'Qué se ve: Un póster.', 'Textos visibles: «Rebajas»'
    ])
  })
  it('lo sensible vuelve vacío: no se conserva nada de lo visto', () => {
    expect(validarPantalla('{"sensible": true, "que_se_ve": "contraseña 1234"}')).toEqual({
      sensible: true, actividad: 'otra', app: '', que_se_ve: '', titulo_obra: '', textos_visibles: []
    })
  })
})

describe('describirImagen', () => {
  it('un error del proveedor nunca muestra la clave, aunque el servidor la devuelva', async () => {
    const clave = 'sk-secreta-123456'
    const pedir = vi.fn(async () => new Response(`clave inválida: ${clave}`, { status: 401 }))
    const error = await describirImagen({ proveedor: 'openai', modelo: 'm', jpeg: 'AA', prompt: 'p', clave, pedir }).catch((e: Error) => e.message)
    expect(error).toContain('401')
    expect(error).not.toContain(clave)
    const [, init] = pedir.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${clave}`)
    expect(String(init.body)).not.toContain(clave)
  })
  it('Ollama solo en 127.0.0.1', async () => {
    await expect(describirImagen({ proveedor: 'ollama', modelo: 'm', jpeg: 'AA', prompt: 'p', baseUrl: 'http://0.0.0.0:11434/v1' })).rejects.toThrow('127.0.0.1')
  })
})

describe('ServicioVision', () => {
  const crear = (dir: string, cfg: Partial<ConfigVision> = {}, respuesta = BUENA) => {
    const pedir = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: respuesta } }] })))
    const s = new ServicioVision({
      config: { proveedor: 'ollama', modelo: 'gemma3:4b', baseUrl: '', maxDia: 2, ...cfg },
      clave: () => undefined,
      archivoConsentimiento: join(dir, 'consentimientos.json'),
      archivoUso: join(dir, 'uso.json'),
      pedir
    })
    return { s, pedir }
  }

  it('el permiso se pide una vez y vale aunque cambie el proveedor; respeta otros consentimientos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbe-vision-'))
    writeFileSync(join(dir, 'consentimientos.json'), '{"otro":true}')
    const { s } = crear(dir)
    expect(s.estado()).toMatchObject({ activa: false, motivo: 'Falta tu permiso.' })
    await expect(s.describirPantalla(Buffer.from('x'))).rejects.toThrow('permiso')
    s.consentir()
    expect(JSON.parse(readFileSync(join(dir, 'consentimientos.json'), 'utf8')).otro).toBe(true)
    expect(crear(dir, { proveedor: 'claude-cli' }).s.consentida()).toBe(true)
  })

  it('caché por huella (la misma imagen no se envía dos veces) y tope diario', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbe-vision-'))
    const { s, pedir } = crear(dir)
    s.consentir()
    await s.describirPantalla(Buffer.from('a'))
    await s.describirPantalla(Buffer.from('a'))
    expect(pedir).toHaveBeenCalledTimes(1)
    await s.describirPantalla(Buffer.from('b'))
    await expect(s.describirPantalla(Buffer.from('c'))).rejects.toThrow('tope de 2')
  })

  it('descarta la respuesta que no cumple el formato', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbe-vision-'))
    const { s } = crear(dir, {}, 'Veo un póster bonito')
    s.consentir()
    await expect(s.describirPantalla(Buffer.from('a'))).rejects.toThrow('formato')
  })
})

describe('ojos', () => {
  const v = { proceso: 'chrome', titulo: 'Canva', url: 'https://canva.com', aplicacion: 'Google Chrome', pid: 10, restringida: false }
  it('no mira bancos, gestores de contraseñas, ventanas privadas ni a Orbe', () => {
    expect(ventanaPermitida(v, 1)).toBe(true)
    expect(ventanaPermitida({ ...v, url: 'https://www.bancolombia.com' }, 1)).toBe(false)
    expect(ventanaPermitida({ ...v, titulo: 'Nueva pestaña - InPrivate' }, 1)).toBe(false)
    expect(ventanaPermitida({ ...v, proceso: 'Bitwarden' }, 1)).toBe(false)
    expect(ventanaPermitida(v, 10)).toBe(false)
  })
  it('una imagen negra (DRM) no se envía', () => {
    expect(casiNegra(Buffer.alloc(4000))).toBe(true)
    expect(casiNegra(Buffer.alloc(4000, 200))).toBe(false)
  })
})
