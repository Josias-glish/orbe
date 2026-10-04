import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { actualizarEnv, escribirEnv, validarPeticion, vistaConfig } from '../src/main/configuracion'
import { parsearEnv, resolverConfig } from '../src/main/entorno'

const base = {
  proveedor: 'openai',
  modelo: 'llama-3.3-70b-versatile',
  openaiUrl: 'https://api.groq.com/openai/v1',
  openaiKey: 'gsk_nueva',
  anthropicKey: undefined,
  dictado: { url: '', modelo: '', idioma: '', clave: undefined },
  voz: { url: '', modelo: '', voz: '', clave: undefined }
}

describe('actualizarEnv', () => {
  it('reemplaza donde estaba, conserva comentarios y añade lo nuevo al final', () => {
    const antes = '# Mi configuración\nORBE_FONDOS=C:\Fondos\n\n# ORBE_PROVEEDOR=cli\nORBE_PROVEEDOR=auto\n'
    const despues = actualizarEnv(antes, { ORBE_PROVEEDOR: 'openai', ORBE_MODELO: 'm1' })
    expect(despues).toBe('# Mi configuración\nORBE_FONDOS=C:\Fondos\n\n# ORBE_PROVEEDOR=cli\nORBE_PROVEEDOR=openai\n\nORBE_MODELO=m1\n')
  })

  it('null borra la clave y quita repeticiones; no toca las líneas comentadas', () => {
    const antes = 'A=1\n# A=comentada\nA=2\nB=3\n'
    expect(actualizarEnv(antes, { A: null })).toBe('# A=comentada\nB=3\n')
    expect(actualizarEnv('A=1\nA=2\n', { A: 'x' })).toBe('A=x\n')
  })

  it('respeta los saltos de línea de Windows y archivos vacíos', () => {
    expect(actualizarEnv('A=1\r\nB=2\r\n', { B: '5' })).toBe('A=1\r\nB=5\r\n')
    expect(actualizarEnv('', { A: '1' })).toBe('A=1\n')
  })

  it('entrecomilla los valores con espacios o # y siguen leyéndose igual', () => {
    const t = actualizarEnv('', { A: 'a b', B: 'x#y', C: 'sin' })
    expect(parsearEnv(t)).toEqual({ A: 'a b', B: 'x#y', C: 'sin' })
  })
})

describe('validarPeticion', () => {
  it('traduce la petición a cambios del .env', () => {
    const r = validarPeticion(base)
    expect(r.ok && r.cambios).toMatchObject({
      ORBE_PROVEEDOR: 'openai',
      ORBE_MODELO: 'llama-3.3-70b-versatile',
      ORBE_OPENAI_URL: 'https://api.groq.com/openai/v1',
      ORBE_OPENAI_KEY: 'gsk_nueva',
      // Los textos vacíos borran su línea: así se vuelve al valor por defecto.
      ORBE_STT_URL: null,
      ORBE_TTS_VOZ: null
    })
  })

  it('una clave en blanco mantiene la que hay, null la quita, y un texto vacío borra el valor', () => {
    const r = validarPeticion({
      ...base,
      openaiKey: '',
      anthropicKey: null,
      dictado: { url: 'https://api.groq.com/openai/v1', modelo: 'whisper-large-v3-turbo', idioma: 'es', clave: undefined },
      voz: { url: '', modelo: '', voz: '', clave: null }
    })
    expect(r.ok && r.cambios).toMatchObject({
      ANTHROPIC_API_KEY: null,
      ORBE_STT_URL: 'https://api.groq.com/openai/v1',
      ORBE_STT_IDIOMA: 'es',
      ORBE_TTS_URL: null,
      ORBE_TTS_KEY: null
    })
    expect(r.ok && 'ORBE_OPENAI_KEY' in r.cambios).toBe(false)
    expect(r.ok && 'ORBE_STT_KEY' in r.cambios).toBe(false)
  })

  it('rechaza proveedores raros, direcciones que no son web y claves con espacios o saltos de línea', () => {
    expect(validarPeticion({ ...base, proveedor: 'otro' }).ok).toBe(false)
    expect(validarPeticion(null).ok).toBe(false)
    expect(validarPeticion({ ...base, openaiUrl: 'file:///etc/passwd' }).ok).toBe(false)
    expect(validarPeticion({ ...base, openaiUrl: 'https://usuario:clave@sitio.com' }).ok).toBe(false)
    expect(validarPeticion({ ...base, openaiKey: 'abc def' }).ok).toBe(false)
    expect(validarPeticion({ ...base, openaiKey: 'abc\nORBE_PROVEEDOR=x' }).ok).toBe(false)
    expect(validarPeticion({ ...base, modelo: 'm\nX=1' }).ok).toBe(false)
  })

  it('con otro proveedor exige el modelo; con Claude no', () => {
    expect(validarPeticion({ ...base, modelo: '' }).ok).toBe(false)
    const r = validarPeticion({ ...base, proveedor: 'cli', modelo: '' })
    expect(r.ok && r.cambios).toMatchObject({ ORBE_PROVEEDOR: 'cli', ORBE_MODELO: null })
  })

  it('acepta servidores locales por http', () => {
    expect(validarPeticion({ ...base, openaiUrl: 'http://localhost:11434/v1', openaiKey: undefined }).ok).toBe(true)
  })
})

describe('vistaConfig', () => {
  it('enseña qué hay configurado pero nunca las claves', () => {
    const valores = {
      ORBE_PROVEEDOR: 'openai',
      ORBE_MODELO: 'm1',
      ORBE_OPENAI_URL: 'https://api.groq.com/openai/v1',
      ORBE_OPENAI_KEY: 'gsk_SECRETA',
      ORBE_STT_KEY: 'stt_SECRETA',
      ANTHROPIC_API_KEY: 'sk-ant-SECRETA'
    }
    const v = vistaConfig(resolverConfig(valores, {}), valores)
    expect(v).toMatchObject({ proveedor: 'openai', modelo: 'm1', tieneClaveOpenai: true, tieneClaveAnthropic: true })
    expect(v.dictado.tieneClave).toBe(true)
    expect(v.voz.tieneClave).toBe(false)
    expect(JSON.stringify(v)).not.toMatch(/SECRETA/)
  })
})

describe('escribirEnv', () => {
  it('guarda en disco conservando lo que ya había y lo vuelve a leer igual', () => {
    const carpeta = mkdtempSync(join(tmpdir(), 'orbe-config-'))
    const archivo = join(carpeta, '.env')
    writeFileSync(archivo, '# nota\nORBE_FONDOS=C:\Fondos\nORBE_STT_KEY=guardada\n')
    const r = validarPeticion(base)
    if (!r.ok) throw new Error(r.error)
    escribirEnv(archivo, r.cambios)
    const leido = parsearEnv(readFileSync(archivo, 'utf8'))
    expect(leido).toMatchObject({ ORBE_FONDOS: 'C:\Fondos', ORBE_STT_KEY: 'guardada', ORBE_PROVEEDOR: 'openai', ORBE_OPENAI_KEY: 'gsk_nueva' })
    expect(readFileSync(archivo, 'utf8').startsWith('# nota')).toBe(true)
    expect(resolverConfig(leido, {}).proveedor).toBe('openai')
  })

  it('crea el archivo si no existía', () => {
    const archivo = join(mkdtempSync(join(tmpdir(), 'orbe-config-')), 'sub', '.env')
    escribirEnv(archivo, { ORBE_PROVEEDOR: 'cli' })
    expect(readFileSync(archivo, 'utf8')).toBe('ORBE_PROVEEDOR=cli\n')
  })
})
