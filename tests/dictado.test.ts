import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dictado, type EstadoDictado } from '../src/renderer/voz/dictado'

/** Un micrófono de mentira: se puede decidir cuándo «se abre» y ver si se soltó. */
function microfono(): { pista: { stop: ReturnType<typeof vi.fn>; onended: (() => void) | null }; flujo: MediaStream } {
  const pista = { stop: vi.fn(), onended: null as (() => void) | null }
  return { pista, flujo: { getTracks: () => [pista] } as unknown as MediaStream }
}

class GrabadorFalso {
  static creados: GrabadorFalso[] = []
  static fallaAlCrear = false
  static isTypeSupported = (): boolean => true
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor() {
    if (GrabadorFalso.fallaAlCrear) throw new Error('NotSupportedError')
    GrabadorFalso.creados.push(this)
  }
  start(): void {
    this.state = 'recording'
  }
  stop(): void {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array(4000)]) })
    this.onstop?.()
  }
}

describe('dictado por micrófono', () => {
  let abrir: (flujo: MediaStream) => void
  let getUserMedia: ReturnType<typeof vi.fn>
  let transcribir: ReturnType<typeof vi.fn>
  let estados: EstadoDictado[]
  let errores: string[]
  let textos: string[]
  let dictado: Dictado
  const tic = (): Promise<void> => new Promise((ok) => setTimeout(ok, 0))

  beforeEach(() => {
    GrabadorFalso.creados = []
    GrabadorFalso.fallaAlCrear = false
    getUserMedia = vi.fn(() => new Promise<MediaStream>((ok) => (abrir = ok)))
    transcribir = vi.fn(async () => ({ ok: true, texto: 'hola Orbe' }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('MediaRecorder', GrabadorFalso)
    vi.stubGlobal('window', { orbe: { vozInfo: async () => ({ dictado: true }), vozTranscribir: transcribir }, setInterval, clearInterval })
    estados = []
    errores = []
    textos = []
    dictado = new Dictado({ alEstado: (e) => estados.push(e), alTexto: (t) => textos.push(t), alError: (m) => errores.push(m) })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('avisa de que está abriendo el micrófono, graba, y al segundo clic suelta el micrófono y transcribe', async () => {
    const m = microfono()
    void dictado.alternar()
    expect(estados).toEqual(['preparando'])
    await tic()
    abrir(m.flujo)
    await tic()
    expect(dictado.grabando).toBe(true)
    expect(estados.at(-1)).toBe('grabando')

    await dictado.alternar()
    await tic()
    expect(m.pista.stop).toHaveBeenCalledTimes(1)
    expect(transcribir).toHaveBeenCalledTimes(1)
    expect(textos).toEqual(['hola Orbe'])
    expect(estados.at(-1)).toBe('reposo')
    expect(dictado.activo).toBe(false)
  })

  it('un segundo clic mientras se abre el micrófono cancela: no arranca otra grabación ni deja el micrófono abierto', async () => {
    const m = microfono()
    void dictado.alternar()
    await tic()
    void dictado.alternar() // el usuario cree que no ha funcionado y vuelve a pulsar
    void dictado.alternar()
    await tic()
    expect(getUserMedia).toHaveBeenCalledTimes(1)

    abrir(m.flujo)
    await tic()
    expect(m.pista.stop).toHaveBeenCalledTimes(1)
    expect(GrabadorFalso.creados).toHaveLength(0)
    expect(estados.at(-1)).toBe('reposo')
    expect(errores).toEqual([])
    expect(transcribir).not.toHaveBeenCalled()
  })

  it('Esc mientras se abre el micrófono también lo cancela', async () => {
    const m = microfono()
    void dictado.alternar()
    await tic()
    expect(dictado.grabando).toBe(true) // es lo que el panel mira para que Esc cancele
    dictado.cancelar()
    abrir(m.flujo)
    await tic()
    expect(m.pista.stop).toHaveBeenCalled()
    expect(dictado.activo).toBe(false)
  })

  it('si el grabador no arranca, suelta el micrófono y lo dice', async () => {
    GrabadorFalso.fallaAlCrear = true
    const m = microfono()
    void dictado.alternar()
    await tic()
    abrir(m.flujo)
    await tic()
    expect(m.pista.stop).toHaveBeenCalledTimes(1)
    expect(errores).toEqual(['No he podido empezar a grabar con ese micrófono.'])
    expect(estados.at(-1)).toBe('reposo')
  })

  it('si el micrófono se desconecta a media grabación, cierra en vez de quedarse «grabando»', async () => {
    const m = microfono()
    void dictado.alternar()
    await tic()
    abrir(m.flujo)
    await tic()
    // El dispositivo falla: el grabador se queda inactivo sin avisar y la pista termina.
    GrabadorFalso.creados[0]!.state = 'inactive'
    m.pista.onended?.()
    await tic()
    expect(m.pista.stop).toHaveBeenCalled()
    expect(estados.at(-1)).toBe('reposo')
    expect(dictado.activo).toBe(false)
  })
})
