import { estadoLecturaInicial, extraerFrases, textoParaVoz, type EstadoLectura } from '../../shared/voz'

export type MotorVoz = 'windows' | 'neuronal'

export interface PrefsVoz {
  /** Leer en voz alta las respuestas según llegan. */
  activa: boolean
  /** `voiceURI` de la voz de Windows elegida; null = la primera en español que haya. */
  voz: string | null
  velocidad: number
  /** Tono de las voces de Windows (1 = normal; más bajo = más grave). */
  tono: number
  /** Voces de Windows (gratis, sin conexión) o voz neuronal de un servicio externo (más natural, con tu clave). */
  motor: MotorVoz
  /** Enviar el mensaje en cuanto termina el dictado. */
  autoenviar: boolean
}

export const PREFS_POR_DEFECTO: PrefsVoz = { activa: false, voz: null, velocidad: 1, tono: 1, motor: 'windows', autoenviar: false }
export const VELOCIDAD_MIN = 0.6
export const VELOCIDAD_MAX = 1.6
export const TONO_MIN = 0.5
export const TONO_MAX = 1.5
/** El estilo «Jarvis»: grave, pausado y sereno. */
export const ESTILO_JARVIS = { velocidad: 0.9, tono: 0.7 }
const CLAVE = 'orbe.voz'
export const FRASE_DE_PRUEBA = 'Hola, soy Orbe. Así sueno cuando te leo las respuestas.'

/** Lo que se usa de una voz del sistema (así el lector no depende de los tipos del navegador y se puede probar). */
export interface VozSistema {
  name: string
  lang: string
  voiceURI: string
}

/** Lo que se necesita de `SpeechSynthesisUtterance`. */
export interface Dicho {
  lang: string
  voice: VozSistema | null
  rate: number
  pitch: number
  onend: (() => void) | null
  onerror: (() => void) | null
}

/** Lo que se necesita de `speechSynthesis`. */
export interface Sintesis {
  speak(dicho: Dicho): void
  cancel(): void
  getVoices(): VozSistema[]
  addEventListener?(tipo: string, cb: () => void): void
}

type CrearDicho = new (texto: string) => Dicho

/** Pide el audio de una frase a la voz neuronal (lo hace el proceso principal, que guarda la clave). */
export interface Neuronal {
  sintetizar(texto: string): Promise<{ ok: true; audio: Uint8Array; mime: string } | { ok: false; mensaje: string }>
}

/** Reproduce el audio de la voz neuronal y avisa cuando termina. */
export interface Reproductor {
  reproducir(audio: Uint8Array, mime: string, velocidad: number): Promise<void>
  parar(): void
}

export interface ExtrasLector {
  neuronal?: Neuronal
  reproductor?: Reproductor
  /** Algo salió mal con la voz neuronal (se sigue con la de Windows). */
  alError?: (mensaje: string) => void
}

export interface AlmacenPrefs {
  getItem(clave: string): string | null
  setItem(clave: string, valor: string): void
}

const redondear = (v: number, min: number, max: number, defecto: number): number =>
  Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v)) * 10) / 10 : defecto

const MASCULINAS = /\b(raul|raúl|pablo|jorge|diego|david|alvaro|álvaro|juan|carlos|enrique|miguel|pelayo|mateo|andres|andrés|alonso|gonzalo|mark|george|ryan|guy|james)\b/i
const FEMENINAS = /\b(sabina|helena|laura|elena|paulina|lucia|lucía|marisol|dalia|elvira|ximena|zira|hazel|susan|sonia|salome|salomé|catalina|maria|maría|abril|ana|jenny|aria)\b/i

/** La voz de Windows que más se parece a una voz grave de mayordomo: masculina, en español si la hay. */
export function elegirVozMasculina(voces: VozSistema[]): VozSistema | null {
  const espanol = voces.filter((v) => v.lang.toLowerCase().startsWith('es'))
  return (
    espanol.find((v) => MASCULINAS.test(v.name)) ??
    espanol.find((v) => !FEMENINAS.test(v.name)) ??
    voces.find((v) => MASCULINAS.test(v.name)) ??
    null
  )
}

/**
 * Lee las respuestas en voz alta, con las voces de Windows (sin conexión ni claves) o con una voz neuronal de un
 * servicio externo. Habla frase a frase según llega el streaming, se salta los bloques de código y se calla en
 * cuanto empieza otra respuesta, se cancela o se pulsa Esc. Las preferencias se recuerdan en la ventana.
 */
export class LectorVoz {
  private prefs: PrefsVoz
  private estado: EstadoLectura = estadoLecturaInicial()
  private pendiente = ''
  private enCola = 0
  /** Cada vez que se corta la voz cambia: las frases viejas que aún avisen al terminar no cuentan. */
  private generacion = 0
  private readonly escuchas = new Set<() => void>()
  /** La voz neuronal va reproduciendo las frases en orden: cada una espera a que acabe la anterior. */
  private cadena: Promise<void> = Promise.resolve()
  /** La voz neuronal falló en esta respuesta: el resto se dice con la de Windows. */
  private neuronalCaida = false

  constructor(
    private readonly sintesis: Sintesis | null,
    private readonly almacen: AlmacenPrefs | null,
    private readonly extras: ExtrasLector = {}
  ) {
    this.prefs = this.cargar()
    sintesis?.addEventListener?.('voiceschanged', () => this.avisar())
  }

  private cargar(): PrefsVoz {
    try {
      const c = JSON.parse(this.almacen?.getItem(CLAVE) ?? '{}') as Partial<PrefsVoz>
      return {
        activa: c.activa === true,
        voz: typeof c.voz === 'string' ? c.voz : null,
        velocidad: redondear(typeof c.velocidad === 'number' ? c.velocidad : 1, VELOCIDAD_MIN, VELOCIDAD_MAX, 1),
        tono: redondear(typeof c.tono === 'number' ? c.tono : 1, TONO_MIN, TONO_MAX, 1),
        motor: c.motor === 'neuronal' ? 'neuronal' : 'windows',
        autoenviar: c.autoenviar === true
      }
    } catch {
      return { ...PREFS_POR_DEFECTO }
    }
  }

  /** Se puede leer en voz alta (hay voces de Windows o voz neuronal). */
  get disponible(): boolean {
    return this.sintesis !== null || this.extras.neuronal !== undefined
  }

  get hablando(): boolean {
    return this.enCola > 0
  }

  obtenerPrefs(): PrefsVoz {
    return { ...this.prefs }
  }

  fijarPrefs(cambios: Partial<PrefsVoz>): void {
    const siguiente = { ...this.prefs, ...cambios }
    this.prefs = {
      ...siguiente,
      velocidad: redondear(siguiente.velocidad, VELOCIDAD_MIN, VELOCIDAD_MAX, 1),
      tono: redondear(siguiente.tono, TONO_MIN, TONO_MAX, 1)
    }
    try {
      this.almacen?.setItem(CLAVE, JSON.stringify(this.prefs))
    } catch {
      // sin almacenamiento, las preferencias duran hasta cerrar Orbe
    }
    if (!this.prefs.activa) this.parar()
    this.avisar()
  }

  /**
   * «Estilo Jarvis»: una voz grave, pausada y serena. Con las voces de Windows elige la masculina en español y baja
   * el tono; con voz neuronal (si está configurada) la usa, que es la que más se parece.
   */
  aplicarEstiloJarvis(neuronalDisponible: boolean): void {
    this.fijarPrefs({
      activa: true,
      voz: elegirVozMasculina(this.voces())?.voiceURI ?? this.prefs.voz,
      ...ESTILO_JARVIS,
      motor: neuronalDisponible ? 'neuronal' : 'windows'
    })
  }

  /** Las voces de Windows instaladas, con las de español primero. */
  voces(): VozSistema[] {
    const todas = this.sintesis?.getVoices() ?? []
    const espanol = (v: VozSistema): number => (v.lang.toLowerCase().startsWith('es') ? 0 : 1)
    return [...todas].sort((a, b) => espanol(a) - espanol(b) || a.name.localeCompare(b.name))
  }

  private elegirVoz(): VozSistema | null {
    const voces = this.voces()
    return voces.find((v) => v.voiceURI === this.prefs.voz) ?? voces.find((v) => v.lang.toLowerCase().startsWith('es')) ?? null
  }

  alCambiar(cb: () => void): () => void {
    this.escuchas.add(cb)
    return () => this.escuchas.delete(cb)
  }

  private avisar(): void {
    for (const cb of this.escuchas) cb()
  }

  /** Empieza una respuesta nueva: corta lo que se estuviera leyendo y prepara el texto. */
  empezar(): void {
    this.parar()
  }

  /** Llega un trozo de la respuesta: se habla lo que ya sean frases completas. */
  anexar(delta: string): void {
    if (!this.prefs.activa || !this.disponible) return
    this.pendiente += delta
    this.volcar(false)
  }

  /** Terminó la respuesta: se lee lo que quedara sin decir. */
  terminar(): void {
    if (!this.prefs.activa || !this.disponible) return
    this.volcar(true)
  }

  /** Corta la voz y olvida lo que quedaba por decir. */
  parar(): void {
    this.generacion++
    this.sintesis?.cancel()
    this.extras.reproductor?.parar()
    this.cadena = Promise.resolve()
    this.enCola = 0
    this.pendiente = ''
    this.estado = estadoLecturaInicial()
    this.neuronalCaida = false
    this.avisar()
  }

  /** Dice una frase de ejemplo con la voz elegida (aunque la lectura automática esté apagada). */
  probar(): void {
    if (!this.disponible) return
    this.parar()
    for (const f of textoParaVoz(FRASE_DE_PRUEBA)) this.hablar(f)
  }

  private volcar(final: boolean): void {
    const { frases, resto } = extraerFrases(this.pendiente, this.estado, final)
    this.pendiente = resto
    for (const f of frases) this.hablar(f)
  }

  private hablar(frase: string): void {
    if (this.prefs.motor === 'neuronal' && this.extras.neuronal && this.extras.reproductor && !this.neuronalCaida) {
      this.hablarNeuronal(frase)
    } else {
      this.hablarWindows(frase)
    }
  }

  /** La frase se pide al servicio enseguida (así la siguiente ya está lista cuando acaba la actual) y se reproduce en orden. */
  private hablarNeuronal(frase: string): void {
    const { neuronal, reproductor } = this.extras
    if (!neuronal || !reproductor) return
    const generacion = this.generacion
    this.enCola++
    this.avisar()
    const audio = neuronal.sintetizar(frase).catch(() => ({ ok: false as const, mensaje: 'No he podido conectar con el servicio de voz.' }))
    this.cadena = this.cadena
      .then(async () => {
        if (generacion !== this.generacion) return
        const r = await audio
        if (generacion !== this.generacion) return
        if (!r.ok) {
          // Se avisa una vez y el resto de la respuesta sigue con la voz de Windows.
          if (!this.neuronalCaida) this.extras.alError?.(`${r.mensaje} Sigo con la voz de Windows.`)
          this.neuronalCaida = true
          this.hablarWindows(frase)
          return
        }
        await reproductor.reproducir(r.audio, r.mime, this.prefs.velocidad).catch(() => undefined)
      })
      .finally(() => {
        if (generacion !== this.generacion) return
        this.enCola = Math.max(0, this.enCola - 1)
        this.avisar()
      })
  }

  private hablarWindows(frase: string): void {
    if (!this.sintesis) return
    const Crear = (globalThis as unknown as { SpeechSynthesisUtterance?: CrearDicho }).SpeechSynthesisUtterance
    if (!Crear) return
    const voz = this.elegirVoz()
    const dicho = new Crear(frase)
    dicho.lang = voz?.lang ?? 'es-ES'
    if (voz) dicho.voice = voz
    dicho.rate = this.prefs.velocidad
    dicho.pitch = this.prefs.tono
    const generacion = this.generacion
    const alTerminar = (): void => {
      if (generacion !== this.generacion) return
      this.enCola = Math.max(0, this.enCola - 1)
      this.avisar()
    }
    dicho.onend = alTerminar
    dicho.onerror = alTerminar
    this.enCola++
    this.sintesis.speak(dicho)
    this.avisar()
  }
}
