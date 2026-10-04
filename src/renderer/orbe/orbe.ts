import type { EstadoOrbe } from '../../shared/tipos'
import fuenteFragmento from './shaders/orbe.frag.glsl?raw'
import fuenteVertice from './shaders/orbe.vert.glsl?raw'
import { DURACION_BARRIDO, PARAMETROS, fpsMaximos, suavizar, type ParametrosOrbe } from './estados'

const NOMBRES_UNIFORMS = [
  'uResolucion',
  'uFase',
  'uFaseOnda',
  'uAmplitud',
  'uTurbulencia',
  'uBarrido',
  'uEnergia',
  'uBrillo'
] as const

type NombreUniform = (typeof NOMBRES_UNIFORMS)[number]

/** Orbe fluido dibujado con un fragment shader (WebGL2). Gestiona su propio bucle de animación. */
export class Orbe {
  private readonly gl: WebGL2RenderingContext
  private readonly uniforms = {} as Record<NombreUniform, WebGLUniformLocation | null>

  private estado: EstadoOrbe = 'reposo'
  private actual: ParametrosOrbe = { ...PARAMETROS.reposo }
  private fase = Math.random() * 100
  private faseOnda = 0
  /** Energía añadida por los pulsos del streaming; decae sola. */
  private pulsoEnergia = 0
  private progresoBarrido = -1

  private visible = true
  private idRaf = 0
  private ultimoDibujo = 0
  private ultimoTick = 0

  // Medición de fps reales, para el diagnóstico y las pruebas.
  private marcaFps = 0
  private cuadrosFps = 0
  private fpsMedidos = 0

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power'
    })
    if (!gl) throw new Error('WebGL2 no está disponible en este equipo.')
    this.gl = gl

    const programa = this.crearPrograma(fuenteVertice, fuenteFragmento)
    gl.useProgram(programa)
    for (const nombre of NOMBRES_UNIFORMS) this.uniforms[nombre] = gl.getUniformLocation(programa, nombre)
    gl.bindVertexArray(gl.createVertexArray())
    gl.clearColor(0, 0, 0, 0)
    gl.disable(gl.BLEND)

    this.ajustarTamano()
    new ResizeObserver(() => this.ajustarTamano()).observe(canvas)
    document.addEventListener('visibilitychange', () => this.fijarVisible(!document.hidden))
  }

  private crearPrograma(vs: string, fs: string): WebGLProgram {
    const { gl } = this
    const compilar = (tipo: number, fuente: string): WebGLShader => {
      const sombreador = gl.createShader(tipo)!
      gl.shaderSource(sombreador, fuente)
      gl.compileShader(sombreador)
      if (!gl.getShaderParameter(sombreador, gl.COMPILE_STATUS)) {
        throw new Error(`Error al compilar el shader: ${gl.getShaderInfoLog(sombreador)}`)
      }
      return sombreador
    }
    const programa = gl.createProgram()!
    gl.attachShader(programa, compilar(gl.VERTEX_SHADER, vs))
    gl.attachShader(programa, compilar(gl.FRAGMENT_SHADER, fs))
    gl.linkProgram(programa)
    if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) {
      throw new Error(`Error al enlazar el shader: ${gl.getProgramInfoLog(programa)}`)
    }
    return programa
  }

  private ajustarTamano(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const ancho = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const alto = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== ancho || this.canvas.height !== alto) {
      this.canvas.width = ancho
      this.canvas.height = alto
    }
    this.gl.viewport(0, 0, ancho, alto)
  }

  establecerEstado(estado: EstadoOrbe): void {
    if (estado === this.estado) return
    this.estado = estado
    this.progresoBarrido = estado === 'leyendo' ? 0 : -1
  }

  obtenerEstado(): EstadoOrbe {
    return this.estado
  }

  /** Un fragmento de texto llegó en streaming: genera una onda que acompaña al ritmo del texto. */
  pulso(intensidad = 0.5): void {
    this.pulsoEnergia = Math.min(1, this.pulsoEnergia + intensidad)
  }

  /** Pausa o reanuda la animación (ventana oculta o minimizada). */
  fijarVisible(visible: boolean): void {
    if (visible === this.visible) return
    this.visible = visible
    if (visible) this.iniciar()
    else this.detener()
  }

  iniciar(): void {
    if (this.idRaf || !this.visible) return
    this.ultimoTick = performance.now()
    this.idRaf = requestAnimationFrame(this.bucle)
  }

  detener(): void {
    if (this.idRaf) cancelAnimationFrame(this.idRaf)
    this.idRaf = 0
  }

  diagnostico(): Record<string, unknown> {
    const { gl } = this
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      estado: this.estado,
      fps: this.fpsMedidos,
      canvas: [this.canvas.width, this.canvas.height],
      renderizador: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      error: gl.getError()
    }
  }

  private bucle = (ahora: number): void => {
    this.idRaf = requestAnimationFrame(this.bucle)

    // Limitador de fps: en reposo se dibuja como mucho a 30 fps.
    const intervalo = 1000 / fpsMaximos(this.estado)
    if (ahora - this.ultimoDibujo < intervalo - 1.5) return
    this.ultimoDibujo = ahora

    const dt = Math.min((ahora - this.ultimoTick) / 1000, 0.1)
    this.ultimoTick = ahora
    this.avanzar(dt)
    this.dibujar()

    this.cuadrosFps++
    if (ahora - this.marcaFps >= 1000) {
      this.fpsMedidos = Math.round((this.cuadrosFps * 1000) / (ahora - this.marcaFps))
      this.cuadrosFps = 0
      this.marcaFps = ahora
    }
  }

  private avanzar(dt: number): void {
    const objetivo = PARAMETROS[this.estado]
    const tau = 0.35
    const a = this.actual
    a.velocidad = suavizar(a.velocidad, objetivo.velocidad, dt, tau)
    a.amplitud = suavizar(a.amplitud, objetivo.amplitud, dt, tau)
    a.turbulencia = suavizar(a.turbulencia, objetivo.turbulencia, dt, tau)
    a.brillo = suavizar(a.brillo, objetivo.brillo, dt, tau)
    a.energia = suavizar(a.energia, objetivo.energia, dt, tau)

    this.pulsoEnergia = suavizar(this.pulsoEnergia, 0, dt, 0.28)
    this.fase += dt * a.velocidad
    // Las ondas corren más deprisa cuanta más energía hay.
    this.faseOnda += dt * (2.5 + 5 * Math.min(1, a.energia + this.pulsoEnergia))

    if (this.estado === 'leyendo') {
      this.progresoBarrido += dt / DURACION_BARRIDO
      // El destello se repite con una breve pausa mientras dure la lectura.
      if (this.progresoBarrido > 1.35) this.progresoBarrido = 0
    } else if (this.progresoBarrido >= 0) {
      this.progresoBarrido += dt / DURACION_BARRIDO
      if (this.progresoBarrido > 1) this.progresoBarrido = -1
    }
  }

  private dibujar(): void {
    const { gl, uniforms: u, actual: a } = this
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform2f(u.uResolucion, this.canvas.width, this.canvas.height)
    gl.uniform1f(u.uFase, this.fase)
    gl.uniform1f(u.uFaseOnda, this.faseOnda)
    gl.uniform1f(u.uAmplitud, a.amplitud)
    gl.uniform1f(u.uTurbulencia, a.turbulencia)
    gl.uniform1f(u.uBarrido, this.progresoBarrido > 1 ? -1 : this.progresoBarrido)
    gl.uniform1f(u.uEnergia, Math.min(1, a.energia + this.pulsoEnergia))
    gl.uniform1f(u.uBrillo, a.brillo)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}
