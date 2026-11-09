import { EXPRESION_DE_ESTADO, IDS_EXPRESION, type IdExpresion } from '../../shared/expresiones'
import type { EstadoOrbe } from '../../shared/tipos'
import type { Reaccion } from './avatar'

/** Tras este tiempo sin nada que hacer (y sin el cursor encima), el personaje se duerme. */
export const SUENO_MS = 3 * 60_000

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

  constructor(
    private readonly ahora: () => number = () => performance.now(),
    private readonly suenoMs = SUENO_MS
  ) {
    this.ultimaActividad = ahora()
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
        if (despierta) this.expresar('sorprendido', 900)
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
        break
      case 'abrir':
        this.expresar('feliz', 1400)
        break
      case 'caricia':
        this.expresar(Math.random() < 0.5 ? 'enamorado' : 'timido', 2600)
        break
      case 'despertar':
        if (despierta) this.expresar('sorprendido', 900)
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
    return true
  }

  /** La siguiente expresión de la lista (la rueda del ratón las recorre). */
  siguiente(sentido: 1 | -1): IdExpresion {
    const ahora = this.actual()
    const i = IDS_EXPRESION.indexOf(ahora)
    const id = IDS_EXPRESION[(i + sentido + IDS_EXPRESION.length) % IDS_EXPRESION.length]
    this.expresar(id, 2500)
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
    if (!this.encima && t - this.ultimaActividad >= this.suenoMs) this.dormido = true
    if (this.dormido) return 'dormido'
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
