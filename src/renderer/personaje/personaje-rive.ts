import { Rive, RuntimeLoader, StateMachineInputType, type StateMachineInput } from '@rive-app/canvas'
import { indiceExpresion, type IdExpresion } from '../../shared/expresiones'
import type { EstadoOrbe } from '../../shared/tipos'
import { suavizar } from '../orbe/estados'
import type { Avatar, Reaccion } from './avatar'
import { Director } from './director'

/** Número de cada estado para la entrada `estado` del personaje de Rive. */
export const INDICE_ESTADO: Record<EstadoOrbe, number> = { reposo: 0, leyendo: 1, pensando: 2, respondiendo: 3, escuchando: 4, actuando: 5 }

/**
 * Las entradas que Orbe mueve en la máquina de estados del archivo `.riv` (todas opcionales: las que no existan se
 * ignoran). Así se diseña el personaje en el editor de Rive para que Orbe lo controle.
 */
export const ENTRADAS_RIVE = {
  /** Número 0–19: la expresión (el orden de IDS_EXPRESION). */
  expresion: 'expresion',
  /** Número 0–5: reposo, leyendo, pensando, respondiendo, escuchando, actuando. */
  estado: 'estado',
  /** Números -100…100: hacia dónde mira (sigue al cursor). */
  mirarX: 'mirarX',
  mirarY: 'mirarY',
  /** Booleano reservado para la voz (lip sync). Hoy siempre es false: Orbe aún no habla con este personaje. */
  hablando: 'hablando',
  /** Disparadores: llega un trozo de respuesta / el usuario lo acaricia o lo abre. */
  pulso: 'pulso',
  tocar: 'tocar'
} as const

export interface RecursosRive {
  archivo: Uint8Array
  wasm: Uint8Array
  /** Máquina de estados que se usa; si no se dice, la primera del archivo. */
  maquina: string | null
}

/**
 * Un personaje hecho en Rive (rive.app): Orbe carga el `.riv` que elijas y mueve sus entradas según la conversación,
 * el cursor y las 20 expresiones. La lógica de qué cara toca es la misma que la del personaje dibujado.
 * El motor de Rive (WebAssembly) llega desde el proceso principal: no se descarga nada de internet.
 */
export class PersonajeRive implements Avatar {
  private readonly director = new Director()
  private readonly canvas: HTMLCanvasElement
  private rive: Rive | null = null
  private entradas = new Map<string, StateMachineInput>()
  private expresion: IdExpresion = 'neutral'
  private cursor: { x: number; y: number; cuando: number } | null = null
  private mirada = { x: 0, y: 0 }
  private visible = true
  private idRaf = 0
  private ultimo = 0
  private maquina = ''

  private constructor(private readonly contenedor: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'personaje-rive'
    contenedor.append(this.canvas)
    contenedor.addEventListener('pointerenter', () => this.director.reaccionar('encima'))
    contenedor.addEventListener('pointerleave', () => this.director.reaccionar('fuera'))
    contenedor.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.director.siguiente(e.deltaY > 0 ? 1 : -1)
      },
      { passive: false }
    )
  }

  /** Carga el `.riv`; si falla (archivo dañado, sin máquina de estados…), rechaza y la interfaz usa el personaje dibujado. */
  static async crear(contenedor: HTMLElement, recursos: RecursosRive): Promise<PersonajeRive> {
    const p = new PersonajeRive(contenedor)
    try {
      await p.cargar(recursos)
      return p
    } catch (e) {
      p.canvas.remove()
      throw e
    }
  }

  private async cargar(recursos: RecursosRive): Promise<void> {
    const wasm = URL.createObjectURL(new Blob([recursos.wasm as BlobPart], { type: 'application/wasm' }))
    RuntimeLoader.setWasmUrl(wasm)
    const buffer = recursos.archivo.buffer.slice(recursos.archivo.byteOffset, recursos.archivo.byteOffset + recursos.archivo.byteLength) as ArrayBuffer
    await new Promise<void>((resolver, rechazar) => {
      const tiempo = window.setTimeout(() => rechazar(new Error('El archivo .riv tarda demasiado en cargar.')), 8000)
      this.rive = new Rive({
        canvas: this.canvas,
        buffer,
        autoplay: true,
        enableRiveAssetCDN: false,
        automaticallyHandleEvents: false,
        ...(recursos.maquina ? { stateMachines: recursos.maquina } : {}),
        onLoad: () => {
          window.clearTimeout(tiempo)
          try {
            const rive = this.rive!
            this.maquina = recursos.maquina ?? rive.stateMachineNames[0] ?? ''
            if (!this.maquina) throw new Error('El archivo .riv no tiene ninguna máquina de estados.')
            if (!recursos.maquina) rive.play(this.maquina)
            for (const entrada of rive.stateMachineInputs(this.maquina) ?? []) this.entradas.set(entrada.name, entrada)
            rive.resizeDrawingSurfaceToCanvas()
            resolver()
          } catch (e) {
            rechazar(e)
          }
        },
        onLoadError: () => {
          window.clearTimeout(tiempo)
          rechazar(new Error('No he podido abrir el archivo .riv.'))
        }
      })
    })
    new ResizeObserver(() => this.rive?.resizeDrawingSurfaceToCanvas()).observe(this.canvas)
    this.poner(ENTRADAS_RIVE.hablando, false)
    this.iniciar()
  }

  private poner(nombre: string, valor: number | boolean): void {
    const entrada = this.entradas.get(nombre)
    if (!entrada || entrada.type === StateMachineInputType.Trigger) return
    if (entrada.value !== valor) entrada.value = valor
  }

  private disparar(nombre: string): void {
    const entrada = this.entradas.get(nombre)
    if (entrada?.type === StateMachineInputType.Trigger) entrada.fire()
  }

  establecerEstado(estado: EstadoOrbe): void {
    this.director.establecerEstado(estado)
    this.poner(ENTRADAS_RIVE.estado, INDICE_ESTADO[estado])
  }

  obtenerEstado(): EstadoOrbe {
    return this.director.obtenerEstado()
  }

  pulso(): void {
    this.disparar(ENTRADAS_RIVE.pulso)
  }

  expresar(id: IdExpresion | null, duracionMs = 2500): void {
    this.director.expresar(id, duracionMs)
  }

  expresionActual(): IdExpresion | null {
    return this.expresion
  }

  mirarA(x: number, y: number): void {
    this.cursor = { x, y, cuando: performance.now() }
  }

  reaccionar(reaccion: Reaccion): void {
    this.director.reaccionar(reaccion)
    if (reaccion === 'abrir' || reaccion === 'caricia') this.disparar(ENTRADAS_RIVE.tocar)
  }

  fijarVisible(visible: boolean): void {
    this.visible = visible
    if (visible) {
      this.rive?.play(this.maquina)
      this.iniciar()
    } else {
      this.rive?.pause(this.maquina)
      this.detener()
    }
  }

  /** Un bucle ligero (20 veces por segundo) que pasa la expresión y la mirada al personaje; Rive dibuja por su cuenta. */
  iniciar(): void {
    if (this.idRaf || !this.visible) return
    const paso = (ahora: number): void => {
      this.idRaf = requestAnimationFrame(paso)
      if (ahora - this.ultimo < 50) return
      const dt = Math.min(0.2, (ahora - this.ultimo) / 1000)
      this.ultimo = ahora
      this.expresion = this.director.actual()
      this.poner(ENTRADAS_RIVE.expresion, indiceExpresion(this.expresion))
      let objetivo = { x: 0, y: 0 }
      if (this.cursor && ahora - this.cursor.cuando < 4000) {
        const r = this.contenedor.getBoundingClientRect()
        const dx = this.cursor.x - (window.screenX + r.left + r.width / 2)
        const dy = this.cursor.y - (window.screenY + r.top + r.height / 2)
        objetivo = { x: dx / (Math.abs(dx) + 140), y: dy / (Math.abs(dy) + 140) }
      }
      this.mirada.x = suavizar(this.mirada.x, objetivo.x, dt, 0.1)
      this.mirada.y = suavizar(this.mirada.y, objetivo.y, dt, 0.1)
      this.poner(ENTRADAS_RIVE.mirarX, Math.round(this.mirada.x * 100))
      this.poner(ENTRADAS_RIVE.mirarY, Math.round(this.mirada.y * 100))
    }
    this.idRaf = requestAnimationFrame(paso)
  }

  detener(): void {
    if (this.idRaf) cancelAnimationFrame(this.idRaf)
    this.idRaf = 0
  }

  diagnostico(): Record<string, unknown> {
    return { figura: 'rive', estado: this.director.obtenerEstado(), expresion: this.expresion, maquina: this.maquina, entradas: [...this.entradas.keys()] }
  }
}
