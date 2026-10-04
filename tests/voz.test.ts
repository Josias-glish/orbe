import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { permisoPermitido } from '../src/main/permisos'
import { resolverConfig } from '../src/main/entorno'
import { CANALES, type InfoVoz, type ResultadoDictado } from '../src/shared/tipos'
import { AVISO_CODIGO, dividirFrases, estadoLecturaInicial, extraerFrases, limpiarMarkdownLinea, textoParaVoz } from '../src/shared/voz'
import {
  FRASE_DE_PRUEBA,
  LectorVoz,
  PREFS_POR_DEFECTO,
  VELOCIDAD_MAX,
  VELOCIDAD_MIN,
  type AlmacenPrefs,
  type Sintesis,
  type VozSistema
} from '../src/renderer/voz/lector'

type Manejador = (evento: unknown, ...args: unknown[]) => unknown
const electron = vi.hoisted(() => ({ manejadores: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (canal: string, fn: (...args: unknown[]) => unknown) => electron.manejadores.set(canal, fn), on: () => undefined },
  BrowserWindow: class {}
}))
const { MAX_BYTES_AUDIO, ServicioDictado, ServicioSintesis, extensionDeMime, registrarVoz } = await import('../src/main/voz')

describe('limpiarMarkdownLinea', () => {
  it.each([
    ['## Un título', 'Un título'],
    ['> una cita', 'una cita'],
    ['- elemento de lista', 'elemento de lista'],
    ['3. tercer paso', 'tercer paso'],
    ['Esto es **importante** y *esto* también', 'Esto es importante y esto también'],
    ['Usa `npm test` para probar', 'Usa npm test para probar'],
    ['Mira [la guía](https://example.com/guia) completa', 'Mira la guía completa'],
    ['Visita https://example.com/ruta?x=1 ahora', 'Visita enlace ahora'],
    ['![logo de Orbe](logo.png)', 'logo de Orbe'],
    ['| a | b |', 'a b'],
    ['---', ''],
    ['texto <b>con</b> etiquetas', 'texto con etiquetas'],
    ['   mucho    espacio   ', 'mucho espacio'],
    ['snake_case_se_queda y 2*3*4', 'snake_case_se_queda y 2*3*4']
  ])('«%s» → «%s»', (entrada, esperado) => {
    expect(limpiarMarkdownLinea(entrada)).toBe(esperado)
  })
})

describe('dividirFrases', () => {
  it('corta solo donde acaba una frase de verdad: no en los decimales ni en las abreviaturas con punto seguido de letra', () => {
    expect(dividirFrases('Mide 3.5 metros. ¿Seguro? ¡Sí! Fin')).toEqual(['Mide 3.5 metros.', '¿Seguro?', '¡Sí!', 'Fin'])
    expect(dividirFrases('Versión 2.1.289 estable.')).toEqual(['Versión 2.1.289 estable.'])
  })

  it('descarta lo que no tiene letras ni números', () => {
    expect(dividirFrases('... — ...')).toEqual([])
  })

  it('parte las frases larguísimas por las comas', () => {
    const larga = Array.from({ length: 30 }, (_, i) => `elemento número ${i}`).join(', ') + '.'
    const partes = dividirFrases(larga)
    expect(partes.length).toBeGreaterThan(1)
    expect(partes.every((p) => p.length <= 400)).toBe(true)
    expect(partes.join(' ').replace(/\s+/g, ' ')).toContain('elemento número 29.')
  })
})

describe('extraerFrases (streaming)', () => {
  /** Alimenta el texto en trozos como llegaría del modelo y devuelve todo lo que se habría dicho. */
  function hablar(trozos: string[]): string[] {
    const estado = estadoLecturaInicial()
    let acumulado = ''
    const dicho: string[] = []
    for (const t of trozos) {
      acumulado += t
      const { frases, resto } = extraerFrases(acumulado, estado)
      dicho.push(...frases)
      acumulado = resto
    }
    dicho.push(...extraerFrases(acumulado, estado, true).frases)
    return dicho
  }

  it('habla cada frase en cuanto está completa, sin esperar al final', () => {
    const estado = estadoLecturaInicial()
    expect(extraerFrases('Hola, soy Orbe. ¿Qué tal', estado).frases).toEqual(['Hola, soy Orbe.'])
    expect(extraerFrases('¿Qué tal estás? Bien', estado).frases).toEqual(['¿Qué tal estás?'])
  })

  it('el resultado no depende de cómo se parta el texto al llegar', () => {
    const texto = 'Claro. Esto es **muy** útil.\n\n- Primero\n- Segundo\n\nGracias por todo. ¿Algo más?'
    const esperado = textoParaVoz(texto)
    expect(esperado).toEqual(['Claro.', 'Esto es muy útil.', 'Primero', 'Segundo', 'Gracias por todo.', '¿Algo más?'])
    for (const tamano of [1, 2, 3, 5, 7, 13, texto.length]) {
      const trozos = texto.match(new RegExp(`[\\s\\S]{1,${tamano}}`, 'g')) ?? []
      expect(hablar(trozos)).toEqual(esperado)
    }
  })

  it('no lee los bloques de código: avisa una vez y sigue después', () => {
    const texto = 'Mira este ejemplo:\n```ts\nconst a = 1\nconsole.log(a)\n```\nY otro:\n```js\nlet b = 2\n```\nListo.'
    expect(textoParaVoz(texto)).toEqual(['Mira este ejemplo:', AVISO_CODIGO, 'Y otro:', 'Listo.'])
    expect(hablar(texto.match(/[\s\S]{1,4}/g) ?? [])).toEqual(['Mira este ejemplo:', AVISO_CODIGO, 'Y otro:', 'Listo.'])
  })

  it('un bloque de código sin cerrar al final de la respuesta no se lee', () => {
    expect(textoParaVoz('Aquí va:\n```\nrm -rf /\nmás código')).toEqual(['Aquí va:', AVISO_CODIGO])
  })

  it('el texto sin terminar (sin punto final) se dice al terminar la respuesta', () => {
    expect(textoParaVoz('Una frase sin punto final')).toEqual(['Una frase sin punto final'])
  })

  it('un texto vacío o de puro formato no dice nada', () => {
    expect(textoParaVoz('')).toEqual([])
    expect(textoParaVoz('---\n\n***\n')).toEqual([])
  })
})

describe('ServicioDictado', () => {
  const OPCIONES = { disponible: true, url: 'https://api.openai.com/v1/', clave: 'clave-stt', modelo: 'whisper-1', idioma: 'es' }
  const audio = (n = 5000): Uint8Array => new Uint8Array(n).fill(7)

  function conRespuesta(respuesta: Response) {
    const llamadas: Array<{ url: string; init: RequestInit }> = []
    const fetchFalso = (async (url: string, init: RequestInit) => {
      llamadas.push({ url, init })
      return respuesta
    }) as unknown as typeof fetch
    return { llamadas, servicio: new ServicioDictado({ ...OPCIONES, fetch: fetchFalso }) }
  }
  const json = (cuerpo: unknown, estado = 200): Response => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } })

  it('manda el audio como formulario a /audio/transcriptions con el modelo, el idioma y la clave', async () => {
    const { servicio, llamadas } = conRespuesta(json({ text: '  Hola, esto es una prueba.  ' }))
    expect(await servicio.transcribir(audio(), 'audio/webm;codecs=opus')).toBe('Hola, esto es una prueba.')
    const { url, init } = llamadas[0]
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer clave-stt')
    const f = init.body as FormData
    expect(f.get('model')).toBe('whisper-1')
    expect(f.get('language')).toBe('es')
    expect(f.get('response_format')).toBe('json')
    const archivo = f.get('file') as File
    expect(archivo.name).toBe('audio.webm')
    expect(archivo.type).toBe('audio/webm')
    expect(archivo.size).toBe(5000)
  })

  it('sin clave (servidor propio) no manda cabecera de autorización, y sin idioma deja que el servicio lo detecte', async () => {
    const llamadas: RequestInit[] = []
    const servicio = new ServicioDictado({
      ...OPCIONES,
      clave: '',
      idioma: '',
      url: 'http://localhost:8080/v1',
      fetch: (async (_u: string, init: RequestInit) => {
        llamadas.push(init)
        return json({ text: 'ok' })
      }) as unknown as typeof fetch
    })
    await servicio.transcribir(audio(), 'audio/ogg')
    expect(llamadas[0].headers).toEqual({})
    expect((llamadas[0].body as FormData).has('language')).toBe(false)
  })

  it('acepta una respuesta de texto plano', async () => {
    const { servicio } = conRespuesta(new Response('texto sin json', { status: 200 }))
    expect(await servicio.transcribir(audio(), 'audio/webm')).toBe('texto sin json')
  })

  it('un audio en el que no se entiende nada devuelve texto vacío', async () => {
    const { servicio } = conRespuesta(json({ text: '' }))
    expect(await servicio.transcribir(audio(), 'audio/webm')).toBe('')
  })

  it('sin dictado configurado, lo dice sin intentar nada', async () => {
    const { servicio, llamadas } = conRespuesta(json({ text: 'x' }))
    const apagado = new ServicioDictado({ ...OPCIONES, disponible: false })
    await expect(apagado.transcribir(audio(), 'audio/webm')).rejects.toMatchObject({ error: { mensaje: expect.stringContaining('ORBE_STT_KEY') } })
    expect(llamadas).toHaveLength(0)
    expect(servicio.info()).toEqual({ dictado: true, modelo: 'whisper-1', idioma: 'es' })
    expect(apagado.info().dictado).toBe(false)
  })

  it('rechaza el audio vacío, el demasiado grande y los formatos raros antes de mandar nada', async () => {
    const { servicio, llamadas } = conRespuesta(json({ text: 'x' }))
    await expect(servicio.transcribir(new Uint8Array(0), 'audio/webm')).rejects.toMatchObject({ error: { codigo: 'solicitud_invalida' } })
    await expect(servicio.transcribir(new Uint8Array(MAX_BYTES_AUDIO + 1), 'audio/webm')).rejects.toMatchObject({ error: { mensaje: expect.stringContaining('demasiado largo') } })
    await expect(servicio.transcribir(audio(), 'video/mp4')).rejects.toMatchObject({ error: { codigo: 'solicitud_invalida' } })
    await expect(servicio.transcribir(audio(), 'text/html')).rejects.toMatchObject({ error: { codigo: 'solicitud_invalida' } })
    expect(llamadas).toHaveLength(0)
  })

  it.each([
    [401, 'clave_invalida'],
    [413, 'solicitud_invalida'],
    [429, 'limite_uso'],
    [500, 'sobrecarga'],
    [404, 'modelo']
  ])('HTTP %i → %s', async (estado, codigo) => {
    const { servicio } = conRespuesta(json({ error: { message: 'fallo' } }, estado))
    await expect(servicio.transcribir(audio(), 'audio/webm')).rejects.toMatchObject({ error: { codigo } })
  })

  it('el error de clave habla de ORBE_STT_KEY', async () => {
    const { servicio } = conRespuesta(json({}, 401))
    await expect(servicio.transcribir(audio(), 'audio/webm')).rejects.toMatchObject({ error: { mensaje: expect.stringContaining('ORBE_STT_KEY') } })
  })

  it('sin conexión y por tiempo agotado', async () => {
    const sinRed = new ServicioDictado({
      ...OPCIONES,
      fetch: (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch
    })
    await expect(sinRed.transcribir(audio(), 'audio/webm')).rejects.toMatchObject({ error: { codigo: 'sin_conexion' } })

    const lento = new ServicioDictado({
      ...OPCIONES,
      timeoutMs: 100,
      fetch: ((_u: string, init: RequestInit) =>
        new Promise((_r, rechazar) => init.signal?.addEventListener('abort', () => rechazar(new DOMException('abortado', 'AbortError'))))) as unknown as typeof fetch
    })
    await expect(lento.transcribir(audio(), 'audio/webm')).rejects.toMatchObject({ error: { codigo: 'tiempo_agotado' } })
  })

  it.each([
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/ogg', 'ogg'],
    ['audio/mpeg', 'mp3'],
    ['audio/wav', 'wav'],
    ['audio/x-m4a', 'm4a'],
    ['audio/desconocido', 'webm']
  ])('la extensión de %s es .%s', (mime, ext) => expect(extensionDeMime(mime)).toBe(ext))
})

describe('IPC de voz', () => {
  function conectar() {
    electron.manejadores.clear()
    const webContents = {}
    const transcritos: Array<{ bytes: number; mime: string }> = []
    const servicio = new ServicioDictado({
      disponible: true,
      url: 'http://localhost/v1',
      clave: 'k',
      modelo: 'whisper-1',
      idioma: 'es',
      fetch: (async (_u: string, init: RequestInit) => {
        transcritos.push({ bytes: ((init.body as FormData).get('file') as File).size, mime: ((init.body as FormData).get('file') as File).type })
        return new Response(JSON.stringify({ text: 'texto dictado' }), { status: 200 })
      }) as unknown as typeof fetch
    })
    const sintesis = new ServicioSintesis({ disponible: false, url: 'http://localhost/v1', clave: '', modelo: 'tts-1', voz: 'onyx', instrucciones: '' })
    registrarVoz({ webContents } as unknown as BrowserWindow, servicio, sintesis)
    const invocar = async <T = unknown>(canal: string, propio: boolean, ...args: unknown[]): Promise<T> =>
      (await (electron.manejadores.get(canal) as Manejador)({ sender: propio ? webContents : {} }, ...args)) as T
    return { invocar, transcritos }
  }

  it('solo atiende a la ventana de Orbe', async () => {
    const t = conectar()
    await expect(t.invocar(CANALES.vozInfo, false)).rejects.toThrow(/no autorizado/i)
    await expect(t.invocar(CANALES.vozTranscribir, false, new Uint8Array(3000), 'audio/webm')).rejects.toThrow(/no autorizado/i)
    expect(t.transcritos).toHaveLength(0)
  })

  it('info no incluye nunca la clave', async () => {
    const info = await conectar().invocar<InfoVoz>(CANALES.vozInfo, true)
    expect(info).toEqual({ dictado: true, modelo: 'whisper-1', idioma: 'es', neuronal: false, vozNeuronal: 'onyx' })
    expect(JSON.stringify(info)).not.toContain('"k"')
  })

  it('transcribe el audio que llega como Uint8Array o ArrayBuffer', async () => {
    const t = conectar()
    expect(await t.invocar<ResultadoDictado>(CANALES.vozTranscribir, true, new Uint8Array(3000), 'audio/webm')).toEqual({ ok: true, texto: 'texto dictado' })
    expect(await t.invocar<ResultadoDictado>(CANALES.vozTranscribir, true, new ArrayBuffer(4000), 'audio/webm;codecs=opus')).toEqual({ ok: true, texto: 'texto dictado' })
    expect(t.transcritos.map((x) => x.bytes)).toEqual([3000, 4000])
  })

  it.each([['una cadena'], [42], [null], [{}], [[1, 2, 3]]])('rechaza un audio que no es un buffer (%j)', async (audio) => {
    const t = conectar()
    const r = await t.invocar<ResultadoDictado>(CANALES.vozTranscribir, true, audio, 'audio/webm')
    expect(r).toMatchObject({ ok: false, error: { codigo: 'solicitud_invalida' } })
    expect(t.transcritos).toHaveLength(0)
  })

  it('rechaza un tipo que no es texto o que es larguísimo, y devuelve los errores sin lanzarlos', async () => {
    const t = conectar()
    expect(await t.invocar<ResultadoDictado>(CANALES.vozTranscribir, true, new Uint8Array(3000), 42)).toMatchObject({ ok: false })
    expect(await t.invocar<ResultadoDictado>(CANALES.vozTranscribir, true, new Uint8Array(3000), 'audio/' + 'x'.repeat(200))).toMatchObject({ ok: false })
    expect(await t.invocar<ResultadoDictado>(CANALES.vozTranscribir, true, new Uint8Array(3000), 'image/png')).toMatchObject({ ok: false, error: { codigo: 'solicitud_invalida' } })
  })
})

describe('permisos de la ventana', () => {
  it('solo se concede el micrófono (nunca la cámara) y copiar al portapapeles', () => {
    expect(permisoPermitido('media', ['audio'])).toBe(true)
    expect(permisoPermitido('media', ['audio', 'video'])).toBe(false)
    expect(permisoPermitido('media', ['video'])).toBe(false)
    expect(permisoPermitido('media', [])).toBe(false)
    expect(permisoPermitido('media', undefined)).toBe(false)
    expect(permisoPermitido('clipboard-sanitized-write', undefined)).toBe(true)
  })

  it.each(['geolocation', 'notifications', 'clipboard-read', 'midi', 'openExternal', 'display-capture', 'fullscreen', 'hid', 'usb'])('se deniega %s', (p) => {
    expect(permisoPermitido(p, ['audio'])).toBe(false)
  })
})

describe('configuración del dictado', () => {
  it('sin claves no hay dictado', () => {
    expect(resolverConfig({}, {}).dictado).toMatchObject({ disponible: false, modelo: 'whisper-1', idioma: 'es', url: 'https://api.openai.com/v1' })
  })

  it('la clave de OpenAI sirve para dictar; ORBE_STT_KEY manda sobre ella', () => {
    expect(resolverConfig({ ORBE_OPENAI_KEY: 'k1' }, {}).dictado).toMatchObject({ disponible: true, clave: 'k1' })
    expect(resolverConfig({ ORBE_OPENAI_KEY: 'k1', ORBE_STT_KEY: 'k2' }, {}).dictado.clave).toBe('k2')
  })

  it('un servidor propio no necesita clave', () => {
    const d = resolverConfig({ ORBE_STT_URL: 'http://localhost:8080/v1', ORBE_STT_MODELO: 'base', ORBE_STT_IDIOMA: 'en' }, {}).dictado
    expect(d).toEqual({ disponible: true, url: 'http://localhost:8080/v1', clave: '', modelo: 'base', idioma: 'en' })
  })
})

describe('LectorVoz', () => {
  class Dicho {
    text: string
    lang = ''
    rate = 1
    voice: unknown = null
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
    pitch = 1
    constructor(texto: string) {
      this.text = texto
    }
  }
  const VOCES = [
    { name: 'Zira', lang: 'en-US', voiceURI: 'zira' },
    { name: 'Sabina', lang: 'es-MX', voiceURI: 'sabina' },
    { name: 'Helena', lang: 'es-ES', voiceURI: 'helena' }
  ] as unknown as VozSistema[]

  function montar(prefs: Partial<typeof PREFS_POR_DEFECTO> = {}) {
    const dichos: Dicho[] = []
    let cancelaciones = 0
    const sintesis = {
      speak: (d: Dicho) => dichos.push(d),
      cancel: () => cancelaciones++,
      getVoices: () => VOCES
    } as unknown as Sintesis
    const datos = new Map<string, string>()
    if (Object.keys(prefs).length) datos.set('orbe.voz', JSON.stringify({ ...PREFS_POR_DEFECTO, ...prefs }))
    const almacen: AlmacenPrefs = { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => void datos.set(k, v) }
    const lector = new LectorVoz(sintesis, almacen)
    return { lector, dichos, datos, cancelaciones: () => cancelaciones }
  }

  beforeEach(() => {
    ;(globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = Dicho
  })

  it('por defecto no lee nada en voz alta', () => {
    const { lector, dichos } = montar()
    lector.empezar()
    lector.anexar('Hola. ¿Qué tal?')
    lector.terminar()
    expect(dichos).toHaveLength(0)
    expect(lector.hablando).toBe(false)
  })

  it('con la lectura activada habla frase a frase según llega el texto, y lo que queda al terminar', () => {
    const { lector, dichos } = montar({ activa: true })
    lector.empezar()
    lector.anexar('Hola, soy Orbe. ')
    expect(dichos.map((d) => d.text)).toEqual(['Hola, soy Orbe.'])
    lector.anexar('Dime algo')
    expect(dichos).toHaveLength(1)
    lector.terminar()
    expect(dichos.map((d) => d.text)).toEqual(['Hola, soy Orbe.', 'Dime algo'])
    expect(lector.hablando).toBe(true)
    dichos.forEach((d) => d.onend?.())
    expect(lector.hablando).toBe(false)
  })

  it('usa la primera voz en español, aunque haya otras antes, y la velocidad elegida', () => {
    const { lector, dichos } = montar({ activa: true, velocidad: 1.3 })
    lector.empezar()
    lector.anexar('Una frase. ')
    expect((dichos[0].voice as { voiceURI: string }).voiceURI).toBe('helena')
    expect(dichos[0].lang).toBe('es-ES')
    expect(dichos[0].rate).toBe(1.3)
  })

  it('respeta la voz elegida en las preferencias', () => {
    const { lector, dichos } = montar({ activa: true, voz: 'sabina' })
    lector.empezar()
    lector.anexar('Una frase. ')
    expect((dichos[0].voice as { voiceURI: string }).voiceURI).toBe('sabina')
  })

  it('las voces se ofrecen con las de español primero', () => {
    expect(montar().lector.voces().map((v) => v.name)).toEqual(['Helena', 'Sabina', 'Zira'])
  })

  it('una respuesta nueva corta lo que se estuviera diciendo; parar también', () => {
    const { lector, dichos, cancelaciones } = montar({ activa: true })
    lector.empezar()
    lector.anexar('Primera respuesta larga. ')
    const antes = cancelaciones()
    lector.empezar()
    expect(cancelaciones()).toBe(antes + 1)
    expect(lector.hablando).toBe(false)
    // El aviso de fin de la frase vieja, que llega tarde, no descuadra la cuenta.
    dichos[0].onend?.()
    expect(lector.hablando).toBe(false)
    lector.anexar('Segunda. ')
    expect(lector.hablando).toBe(true)
    lector.parar()
    expect(lector.hablando).toBe(false)
  })

  it('apagar la lectura la corta al momento y se recuerda', () => {
    const { lector, datos } = montar({ activa: true })
    lector.empezar()
    lector.anexar('Hablando. ')
    expect(lector.hablando).toBe(true)
    lector.fijarPrefs({ activa: false })
    expect(lector.hablando).toBe(false)
    expect(JSON.parse(datos.get('orbe.voz')!)).toMatchObject({ activa: false })
  })

  it('las preferencias se guardan y se recuperan en otro arranque; la velocidad se limita', () => {
    const { lector, datos } = montar()
    lector.fijarPrefs({ activa: true, voz: 'sabina', velocidad: 9, autoenviar: true })
    expect(lector.obtenerPrefs()).toEqual({ activa: true, voz: 'sabina', velocidad: VELOCIDAD_MAX, tono: 1, motor: 'windows', autoenviar: true })
    lector.fijarPrefs({ velocidad: 0 })
    expect(lector.obtenerPrefs().velocidad).toBe(VELOCIDAD_MIN)
    const almacen: AlmacenPrefs = { getItem: (k) => datos.get(k) ?? null, setItem: () => undefined }
    expect(new LectorVoz(null, almacen).obtenerPrefs()).toMatchObject({ activa: true, voz: 'sabina', autoenviar: true })
  })

  it('un almacenamiento roto o inexistente no impide arrancar', () => {
    const roto: AlmacenPrefs = { getItem: () => '{ no es json', setItem: () => undefined }
    expect(new LectorVoz(null, roto).obtenerPrefs()).toEqual(PREFS_POR_DEFECTO)
    expect(new LectorVoz(null, null).obtenerPrefs()).toEqual(PREFS_POR_DEFECTO)
    const quePeta: AlmacenPrefs = {
      getItem: () => null,
      setItem: () => {
        throw new Error('cuota')
      }
    }
    expect(() => new LectorVoz(null, quePeta).fijarPrefs({ activa: true })).not.toThrow()
  })

  it('probar dice la frase de ejemplo aunque la lectura esté apagada', () => {
    const { lector, dichos } = montar()
    lector.probar()
    expect(dichos.map((d) => d.text).join(' ')).toContain('Hola, soy Orbe')
    expect(FRASE_DE_PRUEBA).toContain('Orbe')
  })

  it('sin voces instaladas ni síntesis, todo se queda callado y no falla', () => {
    const lector = new LectorVoz(null, null)
    expect(lector.disponible).toBe(false)
    lector.fijarPrefs({ activa: true })
    expect(() => {
      lector.empezar()
      lector.anexar('Hola. ')
      lector.terminar()
      lector.probar()
      lector.parar()
    }).not.toThrow()
    expect(lector.voces()).toEqual([])
  })

  it('avisa a la interfaz cuando empieza y deja de hablar', () => {
    const { lector, dichos } = montar({ activa: true })
    const estados: boolean[] = []
    lector.alCambiar(() => estados.push(lector.hablando))
    lector.empezar()
    lector.anexar('Una frase. ')
    dichos[0].onend?.()
    expect(estados).toContain(true)
    expect(estados.at(-1)).toBe(false)
  })

  it('un error de la voz también libera la cola', () => {
    const { lector, dichos } = montar({ activa: true })
    lector.empezar()
    lector.anexar('Una frase. ')
    dichos[0].onerror?.()
    expect(lector.hablando).toBe(false)
  })
})
