import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTRUCCIONES_VOZ_POR_DEFECTO, resolverConfig } from '../src/main/entorno'
import { CANALES, type InfoVoz, type ResultadoSintesis } from '../src/shared/tipos'
import {
  ESTILO_JARVIS,
  LectorVoz,
  PREFS_POR_DEFECTO,
  elegirVozMasculina,
  type AlmacenPrefs,
  type Neuronal,
  type Reproductor,
  type Sintesis,
  type VozSistema
} from '../src/renderer/voz/lector'
import { wavSilencioso } from '../src/main/voz-demo'

type Manejador = (evento: unknown, ...args: unknown[]) => unknown
const electron = vi.hoisted(() => ({ manejadores: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (canal: string, fn: (...args: unknown[]) => unknown) => electron.manejadores.set(canal, fn), on: () => undefined },
  BrowserWindow: class {}
}))
const { MAX_CARACTERES_SINTESIS, ServicioDictado, ServicioSintesis, registrarVoz } = await import('../src/main/voz')

const OPCIONES = { disponible: true, url: 'https://api.openai.com/v1/', clave: 'clave-tts', modelo: 'gpt-4o-mini-tts', voz: 'onyx', instrucciones: 'Habla grave y sereno.' }
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4])

function conRespuesta(respuesta: Response, extra: Partial<typeof OPCIONES> = {}) {
  const llamadas: Array<{ url: string; init: RequestInit }> = []
  const servicio = new ServicioSintesis({
    ...OPCIONES,
    ...extra,
    fetch: (async (url: string, init: RequestInit) => {
      llamadas.push({ url, init })
      return respuesta
    }) as unknown as typeof fetch
  })
  return { servicio, llamadas }
}
const audio = (): Response => new Response(MP3, { status: 200, headers: { 'content-type': 'audio/mpeg' } })

describe('ServicioSintesis', () => {
  it('pide el audio a /audio/speech con la voz, el estilo y la clave, y devuelve los bytes', async () => {
    const { servicio, llamadas } = conRespuesta(audio())
    const r = await servicio.sintetizar('  Buenas tardes, señor.  ')
    expect(r.mime).toBe('audio/mpeg')
    expect([...r.audio]).toEqual([...MP3])
    const { url, init } = llamadas[0]
    expect(url).toBe('https://api.openai.com/v1/audio/speech')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer clave-tts')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'gpt-4o-mini-tts',
      voice: 'onyx',
      input: 'Buenas tardes, señor.',
      response_format: 'mp3',
      instructions: 'Habla grave y sereno.'
    })
  })

  it('las instrucciones de estilo solo van con los modelos que las admiten (con tts-1 darían error)', async () => {
    const { servicio, llamadas } = conRespuesta(audio(), { modelo: 'tts-1' })
    await servicio.sintetizar('Hola')
    expect(JSON.parse(llamadas[0].init.body as string)).not.toHaveProperty('instructions')
    const sin = conRespuesta(audio(), { instrucciones: '  ' })
    await sin.servicio.sintetizar('Hola')
    expect(JSON.parse(sin.llamadas[0].init.body as string)).not.toHaveProperty('instructions')
  })

  it('sin clave (servidor propio) no manda cabecera de autorización', async () => {
    const { servicio, llamadas } = conRespuesta(audio(), { clave: '', url: 'http://localhost:8880/v1' })
    await servicio.sintetizar('Hola')
    expect((llamadas[0].init.headers as Record<string, string>)['authorization']).toBeUndefined()
  })

  it('sin configurar, vacío o demasiado largo: error claro y sin llamar a nadie', async () => {
    const { servicio, llamadas } = conRespuesta(audio())
    const apagado = new ServicioSintesis({ ...OPCIONES, disponible: false })
    await expect(apagado.sintetizar('Hola')).rejects.toMatchObject({ error: { mensaje: expect.stringContaining('ORBE_TTS_KEY') } })
    await expect(servicio.sintetizar('   ')).rejects.toMatchObject({ error: { codigo: 'solicitud_invalida' } })
    await expect(servicio.sintetizar('x'.repeat(MAX_CARACTERES_SINTESIS + 1))).rejects.toMatchObject({ error: { codigo: 'solicitud_invalida' } })
    expect(llamadas).toHaveLength(0)
    expect(servicio.info()).toEqual({ neuronal: true, vozNeuronal: 'onyx' })
  })

  it.each([
    [401, 'clave_invalida'],
    [404, 'modelo'],
    [429, 'limite_uso'],
    [500, 'sobrecarga']
  ])('HTTP %i → %s', async (estado, codigo) => {
    const { servicio } = conRespuesta(new Response(JSON.stringify({ error: { message: 'fallo' } }), { status: estado }))
    await expect(servicio.sintetizar('Hola')).rejects.toMatchObject({ error: { codigo } })
  })

  it('el error de clave habla de ORBE_TTS_KEY; un audio vacío es un error', async () => {
    await expect(conRespuesta(new Response('{}', { status: 401 })).servicio.sintetizar('Hola')).rejects.toMatchObject({ error: { mensaje: expect.stringContaining('ORBE_TTS_KEY') } })
    await expect(conRespuesta(new Response(new Uint8Array(0), { status: 200 })).servicio.sintetizar('Hola')).rejects.toMatchObject({ error: { codigo: 'desconocido' } })
  })

  it('sin conexión y por tiempo agotado', async () => {
    const sinRed = new ServicioSintesis({
      ...OPCIONES,
      fetch: (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch
    })
    await expect(sinRed.sintetizar('Hola')).rejects.toMatchObject({ error: { codigo: 'sin_conexion' } })
    const lento = new ServicioSintesis({
      ...OPCIONES,
      timeoutMs: 100,
      fetch: ((_u: string, init: RequestInit) =>
        new Promise((_r, rechazar) => init.signal?.addEventListener('abort', () => rechazar(new DOMException('x', 'AbortError'))))) as unknown as typeof fetch
    })
    await expect(lento.sintetizar('Hola')).rejects.toMatchObject({ error: { codigo: 'tiempo_agotado' } })
  })

  it('si el servidor no dice el tipo del audio, se asume mp3', async () => {
    const { servicio } = conRespuesta(new Response(MP3, { status: 200 }))
    expect((await servicio.sintetizar('Hola')).mime).toMatch(/^audio\//)
  })

  it('el WAV mudo de la prueba visual es un WAV válido', () => {
    const wav = wavSilencioso(300)
    expect(Buffer.from(wav.subarray(0, 4)).toString()).toBe('RIFF')
    expect(Buffer.from(wav.subarray(8, 12)).toString()).toBe('WAVE')
    expect(wav.length).toBe(44 + 2400 * 2)
    expect(wav.subarray(44).every((b) => b === 0)).toBe(true)
  })
})

describe('IPC de la voz neuronal', () => {
  function conectar(sintesis = conRespuesta(audio()).servicio) {
    electron.manejadores.clear()
    const webContents = {}
    const dictado = new ServicioDictado({ disponible: true, url: 'http://localhost/v1', clave: 'k', modelo: 'whisper-1', idioma: 'es' })
    registrarVoz({ webContents } as unknown as BrowserWindow, dictado, sintesis)
    return async <T = unknown>(canal: string, propio: boolean, ...args: unknown[]): Promise<T> =>
      (await (electron.manejadores.get(canal) as Manejador)({ sender: propio ? webContents : {} }, ...args)) as T
  }

  it('solo atiende a la ventana de Orbe', async () => {
    const invocar = conectar()
    await expect(invocar(CANALES.vozSintetizar, false, 'Hola')).rejects.toThrow(/no autorizado/i)
  })

  it('devuelve el audio; info suma la voz neuronal sin exponer ninguna clave', async () => {
    const invocar = conectar()
    const r = await invocar<ResultadoSintesis>(CANALES.vozSintetizar, true, 'Hola')
    expect(r).toMatchObject({ ok: true, mime: 'audio/mpeg' })
    const info = await invocar<InfoVoz>(CANALES.vozInfo, true)
    expect(info).toMatchObject({ dictado: true, neuronal: true, vozNeuronal: 'onyx' })
    expect(JSON.stringify(info)).not.toContain('clave-tts')
  })

  it.each([[42], [null], [{}], [['a']]])('rechaza un texto que no es una cadena (%j)', async (texto) => {
    const r = await conectar()<ResultadoSintesis>(CANALES.vozSintetizar, true, texto)
    expect(r).toMatchObject({ ok: false, error: { codigo: 'solicitud_invalida' } })
  })

  it('los errores del servicio llegan como resultado, sin lanzar', async () => {
    const malo = conRespuesta(new Response('{}', { status: 401 })).servicio
    const r = await conectar(malo)<ResultadoSintesis>(CANALES.vozSintetizar, true, 'Hola')
    expect(r).toMatchObject({ ok: false, error: { codigo: 'clave_invalida' } })
  })
})

describe('configuración de la voz neuronal', () => {
  it('sin claves no hay voz neuronal; los valores por defecto son los del estilo mayordomo', () => {
    expect(resolverConfig({}, {}).voz).toEqual({
      disponible: false,
      url: 'https://api.openai.com/v1',
      clave: '',
      modelo: 'gpt-4o-mini-tts',
      voz: 'onyx',
      instrucciones: INSTRUCCIONES_VOZ_POR_DEFECTO
    })
    expect(INSTRUCCIONES_VOZ_POR_DEFECTO).toMatch(/sereno.*elegante/s)
  })

  it('la clave de OpenAI sirve; ORBE_TTS_KEY manda; y todo se puede cambiar', () => {
    expect(resolverConfig({ ORBE_OPENAI_KEY: 'k1' }, {}).voz).toMatchObject({ disponible: true, clave: 'k1' })
    const c = resolverConfig(
      { ORBE_OPENAI_KEY: 'k1', ORBE_TTS_KEY: 'k2', ORBE_TTS_URL: 'http://localhost:8880/v1', ORBE_TTS_MODELO: 'kokoro', ORBE_TTS_VOZ: 'bm_george', ORBE_TTS_INSTRUCCIONES: 'Habla rápido.' },
      {}
    ).voz
    expect(c).toEqual({ disponible: true, url: 'http://localhost:8880/v1', clave: 'k2', modelo: 'kokoro', voz: 'bm_george', instrucciones: 'Habla rápido.' })
  })

  it('la clave de otro servicio (Groq en ORBE_OPENAI_KEY) no activa la voz neuronal de OpenAI', () => {
    expect(resolverConfig({ ORBE_OPENAI_URL: 'https://api.groq.com/openai/v1', ORBE_OPENAI_KEY: 'k1' }, {}).voz.disponible).toBe(false)
    expect(resolverConfig({ ORBE_OPENAI_URL: 'https://api.groq.com/openai/v1', ORBE_OPENAI_KEY: 'k1', ORBE_TTS_KEY: 'k2' }, {}).voz.disponible).toBe(true)
  })

  it('un servidor propio no necesita clave', () => {
    expect(resolverConfig({ ORBE_TTS_URL: 'http://localhost:8880/v1' }, {}).voz).toMatchObject({ disponible: true, clave: '' })
  })
})

describe('elegirVozMasculina', () => {
  const v = (name: string, lang: string): VozSistema => ({ name, lang, voiceURI: name })

  it('prefiere una voz masculina en español', () => {
    const voces = [v('Microsoft Sabina - Spanish (Mexico)', 'es-MX'), v('Microsoft Raul - Spanish (Mexico)', 'es-MX'), v('Microsoft David - English', 'en-US')]
    expect(elegirVozMasculina(voces)?.name).toContain('Raul')
  })

  it('si no reconoce el nombre, coge una en español que no sea claramente femenina', () => {
    expect(elegirVozMasculina([v('Voz Rara', 'es-ES'), v('Helena', 'es-ES')])?.name).toBe('Voz Rara')
  })

  it('sin voces en español usa una masculina de otro idioma; sin nada, ninguna', () => {
    expect(elegirVozMasculina([v('Zira', 'en-US'), v('George', 'en-GB')])?.name).toBe('George')
    expect(elegirVozMasculina([v('Zira', 'en-US')])).toBeNull()
    expect(elegirVozMasculina([])).toBeNull()
  })
})

describe('LectorVoz: estilo Jarvis y voz neuronal', () => {
  class Dicho {
    text: string
    lang = ''
    rate = 1
    pitch = 1
    voice: unknown = null
    onend: (() => void) | null = null
    onerror: ((evento?: { error?: string }) => void) | null = null
    constructor(texto: string) {
      this.text = texto
    }
  }
  const VOCES: VozSistema[] = [
    { name: 'Microsoft Sabina', lang: 'es-MX', voiceURI: 'sabina' },
    { name: 'Microsoft Raul', lang: 'es-MX', voiceURI: 'raul' }
  ]

  function montar(prefs: Partial<typeof PREFS_POR_DEFECTO> = {}, neuronal?: Neuronal) {
    const dichos: Dicho[] = []
    const sintesis = { speak: (d: Dicho) => dichos.push(d), cancel: () => undefined, getVoices: () => VOCES } as unknown as Sintesis
    const datos = new Map<string, string>()
    if (Object.keys(prefs).length) datos.set('orbe.voz', JSON.stringify({ ...PREFS_POR_DEFECTO, ...prefs }))
    const almacen: AlmacenPrefs = { getItem: (k) => datos.get(k) ?? null, setItem: (k, x) => void datos.set(k, x) }
    const reproducidos: Array<{ bytes: number; velocidad: number }> = []
    const pendientes: Array<() => void> = []
    let paradas = 0
    const reproductor: Reproductor = {
      reproducir: (audio, _mime, velocidad) =>
        new Promise<void>((resolver) => {
          reproducidos.push({ bytes: audio.length, velocidad })
          pendientes.push(resolver)
        }),
      parar: () => {
        paradas++
        pendientes.splice(0).forEach((r) => r())
      }
    }
    const errores: string[] = []
    const lector = new LectorVoz(sintesis, almacen, { neuronal, reproductor, alError: (m) => errores.push(m) })
    return { lector, dichos, datos, reproducidos, pendientes, errores, paradas: () => paradas }
  }
  const esperar = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))

  beforeEach(() => {
    ;(globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = Dicho
  })

  it('el estilo Jarvis elige la voz masculina, baja el tono, afloja el ritmo y activa la lectura', () => {
    const { lector, datos } = montar()
    lector.aplicarEstiloJarvis(false)
    expect(lector.obtenerPrefs()).toMatchObject({ activa: true, voz: 'raul', motor: 'windows', ...ESTILO_JARVIS })
    expect(ESTILO_JARVIS.tono).toBeLessThan(1)
    expect(ESTILO_JARVIS.velocidad).toBeLessThan(1)
    expect(JSON.parse(datos.get('orbe.voz')!)).toMatchObject({ voz: 'raul', tono: 0.7 })
  })

  it('el estilo Jarvis respeta el motor elegido: por defecto Windows, aunque haya voz neuronal', () => {
    const { lector } = montar()
    lector.aplicarEstiloJarvis(true)
    expect(lector.obtenerPrefs().motor).toBe('windows')
    const neuronal = montar({ motor: 'neuronal' })
    neuronal.lector.aplicarEstiloJarvis(true)
    expect(neuronal.lector.obtenerPrefs().motor).toBe('neuronal')
  })

  it('si el motor neuronal quedó guardado pero ya no está configurado, el estilo Jarvis vuelve a Windows', () => {
    const t = montar({ motor: 'neuronal' })
    t.lector.aplicarEstiloJarvis(false)
    expect(t.lector.obtenerPrefs().motor).toBe('windows')
  })

  it('si el servicio neuronal no está configurado, se habla con Windows aunque el motor guardado sea el neuronal', () => {
    const neuronal: Neuronal = { sintetizar: async () => ({ ok: true, audio: new Uint8Array(1), mime: 'audio/mpeg' }) }
    const t = montar({ activa: true, motor: 'neuronal' }, neuronal)
    t.lector.fijarNeuronalConfigurado(false)
    expect(t.lector.usaNeuronal).toBe(false)
    t.lector.empezar()
    t.lector.anexar('Una frase. ')
    expect(t.dichos).toHaveLength(1)
    expect(t.reproducidos).toHaveLength(0)
    t.lector.fijarNeuronalConfigurado(true)
    expect(t.lector.usaNeuronal).toBe(true)
  })

  it('un fallo real de la voz de Windows se avisa una sola vez; callarla no es un fallo', () => {
    const t = montar({ activa: true })
    t.lector.empezar()
    t.lector.anexar('Primera frase. Segunda frase. ')
    t.dichos[0].onerror?.({ error: 'synthesis-failed' })
    t.dichos[1].onerror?.({ error: 'synthesis-failed' })
    expect(t.errores).toHaveLength(1)
    expect(t.errores[0]).toContain('synthesis-failed')
    const callada = montar({ activa: true })
    callada.lector.empezar()
    callada.lector.anexar('Una frase. ')
    callada.dichos[0].onerror?.({ error: 'canceled' })
    expect(callada.errores).toHaveLength(0)
  })

  it('si Windows aún no ha cargado sus voces, el estilo Jarvis elige la masculina cuando llegan', () => {
    let voces: VozSistema[] = []
    let alCambiar: () => void = () => undefined
    const sintesis = {
      speak: () => undefined,
      cancel: () => undefined,
      getVoices: () => voces,
      addEventListener: (_t: string, cb: () => void) => (alCambiar = cb)
    } as unknown as Sintesis
    const almacen: AlmacenPrefs = { getItem: () => null, setItem: () => undefined }
    const lector = new LectorVoz(sintesis, almacen)
    lector.aplicarEstiloJarvis(false)
    expect(lector.obtenerPrefs().voz).toBeNull()
    voces = VOCES
    alCambiar()
    expect(lector.obtenerPrefs().voz).toBe('raul')
  })

  it('las voces de Windows hablan con el tono elegido', () => {
    const { lector, dichos } = montar({ activa: true, tono: 0.7, velocidad: 0.9 })
    lector.empezar()
    lector.anexar('Buenas tardes. ')
    expect(dichos[0].pitch).toBe(0.7)
    expect(dichos[0].rate).toBe(0.9)
  })

  it('el tono y el motor se guardan y el tono se limita', () => {
    const { lector } = montar()
    lector.fijarPrefs({ tono: 5, motor: 'neuronal' })
    expect(lector.obtenerPrefs()).toMatchObject({ tono: 1.5, motor: 'neuronal' })
    lector.fijarPrefs({ tono: 0 })
    expect(lector.obtenerPrefs().tono).toBe(0.5)
  })

  it('con la voz neuronal pide el audio de cada frase y lo reproduce en orden, una tras otra', async () => {
    const pedidas: string[] = []
    const neuronal: Neuronal = {
      sintetizar: async (t) => {
        pedidas.push(t)
        return { ok: true, audio: new Uint8Array(t.length), mime: 'audio/mpeg' }
      }
    }
    const t = montar({ activa: true, motor: 'neuronal', velocidad: 0.9 }, neuronal)
    t.lector.empezar()
    t.lector.anexar('Primera frase. Segunda frase. ')
    expect(pedidas).toEqual(['Primera frase.', 'Segunda frase.']) // las dos se piden ya: la segunda llega lista
    await esperar(5)
    expect(t.reproducidos).toHaveLength(1) // pero solo suena una
    expect(t.reproducidos[0]).toEqual({ bytes: 'Primera frase.'.length, velocidad: 0.9 })
    expect(t.lector.hablando).toBe(true)
    t.pendientes.shift()!()
    await esperar(5)
    expect(t.reproducidos).toHaveLength(2)
    t.pendientes.shift()!()
    await esperar(5)
    expect(t.lector.hablando).toBe(false)
    expect(t.dichos).toHaveLength(0) // no se usó la voz de Windows
  })

  it('parar corta la voz neuronal y descarta lo que quedaba', async () => {
    const neuronal: Neuronal = { sintetizar: async () => ({ ok: true, audio: new Uint8Array(3), mime: 'audio/mpeg' }) }
    const t = montar({ activa: true, motor: 'neuronal' }, neuronal)
    t.lector.empezar()
    t.lector.anexar('Una. Dos. Tres. ')
    await esperar(5)
    t.lector.parar()
    await esperar(5)
    expect(t.paradas()).toBeGreaterThan(0)
    expect(t.reproducidos).toHaveLength(1) // solo llegó a sonar la primera
    expect(t.lector.hablando).toBe(false)
  })

  it('si la voz neuronal falla, avisa una vez y sigue con la de Windows', async () => {
    const neuronal: Neuronal = { sintetizar: async () => ({ ok: false, mensaje: 'El servicio de voz ha rechazado la clave.' }) }
    const t = montar({ activa: true, motor: 'neuronal' }, neuronal)
    t.lector.empezar()
    t.lector.anexar('Una frase. Otra frase. Tercera. ')
    await esperar(10)
    expect(t.errores).toEqual(['El servicio de voz ha rechazado la clave. Sigo con la voz de Windows.'])
    expect(t.dichos.map((d) => d.text)).toEqual(['Una frase.', 'Otra frase.', 'Tercera.'])
  })

  it('una excepción al pedir el audio también cae a la voz de Windows', async () => {
    const neuronal: Neuronal = {
      sintetizar: async () => {
        throw new Error('red caída')
      }
    }
    const t = montar({ activa: true, motor: 'neuronal' }, neuronal)
    t.lector.empezar()
    t.lector.anexar('Una frase. ')
    await esperar(10)
    expect(t.errores).toHaveLength(1)
    expect(t.dichos.map((d) => d.text)).toEqual(['Una frase.'])
  })

  it('en la respuesta siguiente se vuelve a intentar con la voz neuronal', async () => {
    let falla = true
    const neuronal: Neuronal = {
      sintetizar: async () => (falla ? { ok: false, mensaje: 'caído' } : { ok: true, audio: new Uint8Array(2), mime: 'audio/mpeg' })
    }
    const t = montar({ activa: true, motor: 'neuronal' }, neuronal)
    t.lector.empezar()
    t.lector.anexar('Una. ')
    await esperar(10)
    falla = false
    t.lector.empezar()
    t.lector.anexar('Otra. ')
    await esperar(10)
    expect(t.reproducidos).toHaveLength(1)
  })

  it('con el motor neuronal elegido pero sin él configurado, se usa Windows', () => {
    const t = montar({ activa: true, motor: 'neuronal' })
    t.lector.empezar()
    t.lector.anexar('Una frase. ')
    expect(t.dichos).toHaveLength(1)
  })

  it('probar con la voz neuronal también la usa', async () => {
    const pedidas: string[] = []
    const neuronal: Neuronal = {
      sintetizar: async (t) => {
        pedidas.push(t)
        return { ok: true, audio: new Uint8Array(1), mime: 'audio/mpeg' }
      }
    }
    montar({ motor: 'neuronal' }, neuronal).lector.probar()
    expect(pedidas.join(' ')).toContain('Hola, soy Orbe')
  })
})
