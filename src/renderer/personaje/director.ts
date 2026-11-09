import { EXPRESIONES_OCIOSAS, EXPRESION_DE_ESTADO, IDS_EXPRESION, type IdExpresion } from '../../shared/expresiones'
import type { EstadoOrbe } from '../../shared/tipos'
import type { Reaccion } from './avatar'
import { GESTOS, GESTOS_OCIOSOS, type IdGesto } from './gestos'

/** Tras este tiempo sin nada que hacer (y sin el cursor encima), el personaje se duerme. */
export const SUENO_MS = 3 * 60_000
/** Cada cuánto, en reposo, pone una cara distinta un momento (entre MIN y MAX). */
export const OCIO_MIN_MS = 12_000
export const OCIO_MAX_MS = 28_000
/** Cada cuánto, en reposo, hace un gesto (mirar alrededor, estirarse, un bailecito…). */
export const GESTO_OCIO_MIN_MS = 16_000
export const GESTO_OCIO_MAX_MS = 38_000

/** Lo que el director cuenta hacia fuera (para los sonidos). */
export type EventoDirector = 'caricia' | 'rueda' | 'dormir' | 'despertar'

/** Avisa al resto de la interfaz (los sonidos) sin que el personaje sepa quién escucha. */
export function emitirEventoPersonaje(evento: EventoDirector): void {
  const doc = (globalThis as { document?: { dispatchEvent(e: Event): boolean } }).document
  if (doc) doc.dispatchEvent(new CustomEvent('orbe-personaje', { detail: evento }))
}

/**
 * Decide qué cara toca en cada momento, sin dibujar nada (lo comparten el personaje dibujado y el de Rive):
 *   1. una expresión puntual (una reacción, una elegida en el menú, un aviso de un conector) mientras dura;
 *   2. una expresión fijada por el usuario;
 *   3. la del estado de la conversación (pensando, respondiendo, actuando…);
 *   4. en reposo: contento si tienes el cursor encima, dormido si lleva mucho rato sin pasar nada, y si no, neutral.
 */
export class Director {
  private estado: EstadoOrbe = 'reposo'
  private puntual: { id: IdExpresion; hasta: number } | null = null
  private fijada: IdExpresion | null = null
  private encima = false
  private dormido = false
  private ultimaActividad: number
  private recorrido = 0
  /** Te has ido del ordenador (sin teclado ni ratón un rato, o pantalla bloqueada): duerme hasta que vuelvas. */
  private ausente = false
  private proximoOcio: number
  private ocio: { id: IdExpresion; hasta: number } | null = null
  private gesto: { id: IdGesto; inicio: number; fin: number } | null = null
  private proximoGestoOcio: number

  constructor(
    private readonly ahora: () => number = () => performance.now(),
    private readonly suenoMs = SUENO_MS,
    private readonly avisar: (evento: EventoDirector) => void = emitirEventoPersonaje
  ) {
    this.ultimaActividad = ahora()
    this.proximoOcio = ahora() + OCIO_MIN_MS
    this.proximoGestoOcio = ahora() + GESTO_OCIO_MIN_MS
  }

  /** Hace un gesto (saludar, saltar…). Con `conCara`, pone también su expresión mientras dura. */
  gesticular(id: IdGesto, conCara = false): void {
    const t = this.ahora()
    const def = GESTOS[id]
    this.gesto = { id, inicio: t, fin: t + def.duracionMs }
    this.proximoGestoOcio = Math.max(this.proximoGestoOcio, t + GESTO_OCIO_MIN_MS)
    if (conCara && def.expresion) this.expresar(def.expresion, def.duracionMs)
  }

  /**
   * El gesto en curso y por dónde va (0…1), o null. En reposo, despierto y sin nada que hacer, de vez en cuando
   * empieza uno tranquilo por su cuenta: así nunca se queda quieto mucho rato.
   */
  gestoActual(): { id: IdGesto; progreso: number } | null {
    const t = this.ahora()
    if (this.gesto && t >= this.gesto.fin) this.gesto = null
    if (!this.gesto && t >= this.proximoGestoOcio) {
      this.proximoGestoOcio = t + GESTO_OCIO_MIN_MS + Math.random() * (GESTO_OCIO_MAX_MS - GESTO_OCIO_MIN_MS)
      const despierto = !this.dormido && !this.ausente && this.estado === 'reposo' && !this.fijada
      if (despierto) {
        const id = GESTOS_OCIOSOS[Math.floor(Math.random() * GESTOS_OCIOSOS.length)]
        this.gesto = { id, inicio: t, fin: t + GESTOS[id].duracionMs }
      }
    }
    if (!this.gesto) return null
    return { id: this.gesto.id, progreso: (t - this.gesto.inicio) / (this.gesto.fin - this.gesto.inicio) }
  }

  establecerEstado(estado: EstadoOrbe): void {
    this.estado = estado
    this.actividad()
  }

  obtenerEstado(): EstadoOrbe {
    return this.estado
  }

  /** `null` quita lo puesto; `duracionMs = 0` la deja fijada hasta que se quite. */
  expresar(id: IdExpresion | null, duracionMs = 2500): void {
    if (id === null) {
      this.puntual = null
      this.fijada = null
    } else if (duracionMs <= 0) {
      this.fijada = id
      this.puntual = null
    } else {
      this.puntual = { id, hasta: this.ahora() + duracionMs }
    }
    this.actividad()
  }

  fijadaActual(): IdExpresion | null {
    return this.fijada
  }

  reaccionar(reaccion: Reaccion): void {
    const despierta = this.dormido
    this.actividad()
    switch (reaccion) {
      case 'encima':
        this.encima = true
        if (despierta) {
          this.expresar('sorprendido', 900)
          this.avisar('despertar')
        }
        break
      case 'fuera':
        this.encima = false
        this.recorrido = 0
        break
      case 'arrastre':
        this.expresar('sorprendido', 60_000)
        break
      case 'soltar':
        this.expresar('risa', 1200)
        this.gesticular('sacudida')
        break
      case 'abrir':
        this.expresar('feliz', 1400)
        this.gesticular('salto')
        break
      case 'caricia':
        this.expresar(Math.random() < 0.5 ? 'enamorado' : 'timido', 2600)
        break
      case 'ausente':
        this.ausente = true
        break
      case 'vuelve':
        if (this.ausente || despierta) {
          this.ausente = false
          this.expresar('sorprendido', 900)
          this.avisar('despertar')
          this.gesticular('saludo')
        }
        break
      case 'despertar':
        if (despierta) {
          this.expresar('sorprendido', 900)
          this.avisar('despertar')
        }
        break
    }
  }

  /** El cursor se mueve por encima: si lo hace mucho (una «caricia»), reacciona. Devuelve true si hubo caricia. */
  moverEncima(distancia: number): boolean {
    this.actividad()
    this.recorrido += distancia
    if (this.recorrido < 900) return false
    this.recorrido = 0
    if (this.puntual && this.ahora() < this.puntual.hasta) return false
    this.reaccionar('caricia')
    this.avisar('caricia')
    return true
  }

  /** La siguiente expresión de la lista (la rueda del ratón las recorre). */
  siguiente(sentido: 1 | -1): IdExpresion {
    const ahora = this.actual()
    const i = IDS_EXPRESION.indexOf(ahora)
    const id = IDS_EXPRESION[(i + sentido + IDS_EXPRESION.length) % IDS_EXPRESION.length]
    this.expresar(id, 2500)
    this.avisar('rueda')
    return id
  }

  actual(): IdExpresion {
    const t = this.ahora()
    if (this.puntual) {
      if (t < this.puntual.hasta) return this.puntual.id
      this.puntual = null
    }
    if (this.fijada) return this.fijada
    if (this.estado !== 'reposo') return EXPRESION_DE_ESTADO[this.estado]
    if (this.ausente) return 'dormido'
    if (!this.dormido && !this.encima && t - this.ultimaActividad >= this.suenoMs) {
      this.dormido = true
      this.avisar('dormir')
    }
    if (this.dormido) return 'dormido'
    // En reposo, de vez en cuando una cara distinta un momento: así se nota vivo aunque no hables con él.
    // Solo en reposo: en cuanto piensa o responde, manda la cara del estado.
    if (t >= this.proximoOcio) {
      this.proximoOcio = t + OCIO_MIN_MS + Math.random() * (OCIO_MAX_MS - OCIO_MIN_MS)
      this.ocio = { id: EXPRESIONES_OCIOSAS[Math.floor(Math.random() * EXPRESIONES_OCIOSAS.length)], hasta: t + 2200 }
    }
    if (this.ocio && t < this.ocio.hasta) return this.ocio.id
    return this.encima ? 'feliz' : 'neutral'
  }

  estaDormido(): boolean {
    this.actual()
    return this.dormido
  }

  private actividad(): void {
    this.ultimaActividad = this.ahora()
    this.dormido = false
  }
}
