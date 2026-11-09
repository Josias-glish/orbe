/**
 * Los sonidos del personaje, sintetizados al momento con WebAudio: sin archivos, sin conexión y sin gastar memoria.
 * Son cortos y suaves (como los de un juguete), y se pueden apagar desde el menú del personaje.
 */
export type Sonido =
  | 'abrir'
  | 'cerrar'
  | 'caricia'
  | 'rueda'
  | 'sorpresa'
  | 'risa'
  | 'aviso'
  | 'terminado'
  | 'error'
  | 'dormir'
  | 'despertar'
  | 'enviar'
  | 'respuesta'

const CLAVE = 'orbe.sonidos'

/** Lo poco de WebAudio que se usa (así el módulo también se puede probar fuera del navegador). */
interface Parametro {
  setValueAtTime(v: number, t: number): void
  exponentialRampToValueAtTime(v: number, t: number): void
}
interface ContextoAudio {
  currentTime: number
  state: string
  destination: unknown
  resume(): Promise<void>
  createOscillator(): { type: string; frequency: Parametro; connect(n: unknown): { connect(n: unknown): unknown }; start(t: number): void; stop(t: number): void }
  createGain(): { gain: Parametro }
}

interface Nota {
  /** Frecuencia en Hz (o [inicio, fin] para un deslizamiento). */
  f: number | [number, number]
  /** Cuándo empieza, en segundos desde el disparo. */
  t: number
  /** Duración en segundos. */
  d: number
  tipo?: 'sine' | 'square' | 'triangle' | 'sawtooth'
  vol?: number
}

/** Cada sonido es una pequeña secuencia de notas. */
export const PARTITURAS: Record<Sonido, Nota[]> = {
  abrir: [
    { f: 523, t: 0, d: 0.09, tipo: 'sine' },
    { f: 784, t: 0.07, d: 0.14, tipo: 'sine' }
  ],
  cerrar: [
    { f: 659, t: 0, d: 0.08, tipo: 'sine' },
    { f: 440, t: 0.06, d: 0.12, tipo: 'sine' }
  ],
  caricia: [
    { f: [700, 980], t: 0, d: 0.12, tipo: 'triangle', vol: 0.7 },
    { f: [980, 1240], t: 0.1, d: 0.12, tipo: 'triangle', vol: 0.6 }
  ],
  rueda: [{ f: 1400, t: 0, d: 0.03, tipo: 'square', vol: 0.25 }],
  sorpresa: [{ f: [420, 900], t: 0, d: 0.16, tipo: 'sine' }],
  risa: [
    { f: 880, t: 0, d: 0.06, tipo: 'triangle' },
    { f: 990, t: 0.08, d: 0.06, tipo: 'triangle' },
    { f: 1100, t: 0.16, d: 0.08, tipo: 'triangle' }
  ],
  aviso: [
    { f: 988, t: 0, d: 0.12, tipo: 'sine' },
    { f: 988, t: 0.18, d: 0.16, tipo: 'sine' }
  ],
  terminado: [
    { f: 523, t: 0, d: 0.1, tipo: 'sine' },
    { f: 659, t: 0.08, d: 0.1, tipo: 'sine' },
    { f: 784, t: 0.16, d: 0.1, tipo: 'sine' },
    { f: 1047, t: 0.24, d: 0.22, tipo: 'sine' }
  ],
  error: [
    { f: [330, 220], t: 0, d: 0.22, tipo: 'triangle' },
    { f: [220, 196], t: 0.2, d: 0.2, tipo: 'triangle', vol: 0.7 }
  ],
  dormir: [
    { f: [600, 300], t: 0, d: 0.45, tipo: 'sine', vol: 0.6 }
  ],
  despertar: [{ f: [300, 760], t: 0, d: 0.2, tipo: 'sine' }],
  enviar: [{ f: [500, 1100], t: 0, d: 0.12, tipo: 'sine', vol: 0.5 }],
  respuesta: [{ f: 1318, t: 0, d: 0.1, tipo: 'sine', vol: 0.45 }]
}

/** Duración total de un sonido (para las pruebas y para no solaparlos). */
export function duracion(sonido: Sonido): number {
  return Math.max(...PARTITURAS[sonido].map((n) => n.t + n.d))
}

export class Sonidos {
  private contexto: ContextoAudio | null = null
  private activos: boolean
  private ultimo = new Map<Sonido, number>()

  constructor(
    private readonly almacen: Storage | null,
    /** Volumen general (0–1): suave por defecto. */
    private readonly volumen = 0.18
  ) {
    let guardado: string | null = null
    try {
      guardado = almacen?.getItem(CLAVE) ?? null
    } catch {
      // sin almacenamiento, encendidos
    }
    this.activos = guardado !== 'no'
  }

  get encendidos(): boolean {
    return this.activos
  }

  fijar(encendidos: boolean): void {
    this.activos = encendidos
    try {
      this.almacen?.setItem(CLAVE, encendidos ? 'si' : 'no')
    } catch {
      // no se recuerda, pero funciona
    }
  }

  /** Suena (si están encendidos). El mismo sonido no se repite antes de que acabe el anterior. */
  tocar(sonido: Sonido): void {
    if (!this.activos) return
    const ahora = performance.now()
    if ((this.ultimo.get(sonido) ?? 0) + duracion(sonido) * 1000 > ahora) return
    this.ultimo.set(sonido, ahora)
    try {
      const Contexto = (globalThis as { AudioContext?: new () => ContextoAudio }).AudioContext
      if (!Contexto) return
      this.contexto ??= new Contexto()
      const ctx = this.contexto
      if (ctx.state === 'suspended') void ctx.resume()
      const inicio = ctx.currentTime + 0.01
      for (const n of PARTITURAS[sonido]) {
        const osc = ctx.createOscillator()
        const gan = ctx.createGain()
        osc.type = n.tipo ?? 'sine'
        const [f0, f1] = Array.isArray(n.f) ? n.f : [n.f, n.f]
        osc.frequency.setValueAtTime(f0, inicio + n.t)
        if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, inicio + n.t + n.d)
        // Envolvente corta: ataque rápido y caída suave, sin chasquidos.
        const pico = this.volumen * (n.vol ?? 1)
        gan.gain.setValueAtTime(0.0001, inicio + n.t)
        gan.gain.exponentialRampToValueAtTime(pico, inicio + n.t + 0.012)
        gan.gain.exponentialRampToValueAtTime(0.0001, inicio + n.t + n.d)
        osc.connect(gan).connect(ctx.destination)
        osc.start(inicio + n.t)
        osc.stop(inicio + n.t + n.d + 0.02)
      }
    } catch {
      // sin audio (equipo sin salida de sonido): se ignora
    }
  }
}
