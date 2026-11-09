import type { IdExpresion } from '../../shared/expresiones'
import type { EstadoOrbe } from '../../shared/tipos'
import type { Avatar, Reaccion } from './avatar'

/**
 * La figura de la esquina mientras se decide cuál es (personaje, orbe o Rive, que llega del proceso principal):
 * reenvía todo a la que esté puesta y, hasta entonces, recuerda el estado para aplicarlo al montarla.
 */
export class FiguraEsquina implements Avatar {
  private actual: Avatar | null = null
  private estado: EstadoOrbe = 'reposo'
  private visible = true

  poner(figura: Avatar): void {
    this.actual?.detener()
    this.actual = figura
    figura.establecerEstado(this.estado)
    figura.fijarVisible(this.visible)
    figura.iniciar()
  }

  establecerEstado(estado: EstadoOrbe): void {
    this.estado = estado
    this.actual?.establecerEstado(estado)
  }
  obtenerEstado(): EstadoOrbe {
    return this.actual?.obtenerEstado() ?? this.estado
  }
  pulso(intensidad?: number): void {
    this.actual?.pulso(intensidad)
  }
  fijarVisible(visible: boolean): void {
    this.visible = visible
    this.actual?.fijarVisible(visible)
  }
  iniciar(): void {
    this.actual?.iniciar()
  }
  detener(): void {
    this.actual?.detener()
  }
  diagnostico(): Record<string, unknown> {
    return this.actual?.diagnostico() ?? { figura: 'cargando', estado: this.estado }
  }
  expresar(id: IdExpresion | null, duracionMs?: number): void {
    this.actual?.expresar(id, duracionMs)
  }
  expresionActual(): IdExpresion | null {
    return this.actual?.expresionActual() ?? null
  }
  mirarA(x: number, y: number): void {
    this.actual?.mirarA(x, y)
  }
  reaccionar(reaccion: Reaccion): void {
    this.actual?.reaccionar(reaccion)
  }
}
