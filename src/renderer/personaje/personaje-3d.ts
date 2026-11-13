import {
  AmbientLight,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  AdditiveBlending
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { EXPRESIONES, caraNumerica, type CaraNumerica, type Expresion, type IdExpresion } from '../../shared/expresiones'
import type { CalibracionModelo, EstadoOrbe } from '../../shared/tipos'
import { suavizar } from '../orbe/estados'
import type { Avatar, Reaccion } from './avatar'
import { Director } from './director'
import { POSE_NEUTRA, poseGesto, type IdGesto, type Pose } from './gestos'
import { aplicarDetalle, texturaDetalle } from './detalle-material'
import { dibujarAdorno, dibujarMano, dibujarOjoLed } from './dibujo-led'

/** Color de las luces (los «ojos» de las gafas y el contraluz) según el estado de la conversación. */
const COLOR_ESTADO: Record<EstadoOrbe, string> = {
  reposo: '#67e8f9',
  leyendo: '#5eead4',
  pensando: '#c4b5fd',
  respondiendo: '#7dd3fc',
  escuchando: '#f0abfc',
  actuando: '#38bdf8'
}

/** Dónde están los cristales en la foto del modelo (relativo a su silueta), si el modelo no trae su propia calibración. */
export const CALIBRACION_POR_DEFECTO: CalibracionModelo = {
  lentes: { x: 0.158, y: 0.505, ancho: 0.26, alto: 0.12 },
  encuadre: { arriba: 0, abajo: 1 },
  giro: { y: 0, x: 0 },
  cuello: 0.36
}

export interface RecursosModelo {
  glb: Uint8Array
  calibracion?: Partial<CalibracionModelo>
  detalles?: { pelo?: Uint8Array; tejido?: Uint8Array }
}

/**
 * El personaje en 3D (three.js): un modelo GLB que respira, bota, se ladea y gira la cabeza hacia el cursor. Sus
 * gafas oscuras hacen de pantalla: las 20 expresiones se dibujan como ojos de luz en los cristales, y los adornos
 * (corazones, zzz, «?»…) flotan alrededor. Pinta a 30 fps en reposo, a 60 cuando hace algo y se para si no se ve.
 */
export class Personaje3D implements Avatar {
  private readonly director = new Director()
  private readonly canvas: HTMLCanvasElement
  private readonly capaAdornos: HTMLCanvasElement
  private readonly renderer: WebGLRenderer
  private readonly escena = new Scene()
  private readonly camara = new PerspectiveCamera(24, 1, 0.01, 100)
  private readonly pivote = new Group()
  private readonly contraluz: DirectionalLight
  private lentes: Array<{ malla: Mesh; lienzo: HTMLCanvasElement; textura: CanvasTexture }> = []

  private cara: CaraNumerica = caraNumerica(EXPRESIONES.neutral)
  private expresion: IdExpresion = 'neutral'
  private formaVisible: Expresion = EXPRESIONES.neutral
  private cambioForma = 0
  private cursor: { x: number; y: number; cuando: number } | null = null
  private mirada = { x: 0, y: 0 }
  private paseo = { x: 0, y: 0, proximo: 0 }
  private parpadeo = 1
  private proximoParpadeo = performance.now() + 2500
  private pulsoEnergia = 0
  private t = 0
  private colorLuz = new Color(COLOR_ESTADO.reposo)
  private colorObjetivo = new Color(COLOR_ESTADO.reposo)
  private ultimaFirmaLed = ''
  private pose: Pose = POSE_NEUTRA
  /** Altura del modelo en unidades de la escena (para que los saltos midan lo mismo con cualquier modelo). */
  private altoModelo = 1

  private visible = true
  private idRaf = 0
  private ultimoTick = 0
  private ultimoDibujo = 0
  private marcaFps = 0
  private cuadros = 0
  private fps = 0
  private triangulos = 0

  private constructor(
    private readonly contenedor: HTMLElement,
    private readonly calibracion: CalibracionModelo
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'personaje-3d'
    this.capaAdornos = document.createElement('canvas')
    this.capaAdornos.className = 'personaje-3d-adornos'
    contenedor.append(this.canvas, this.capaAdornos)

    this.renderer = new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.setClearColor(0x000000, 0)

    // Luz de estudio suave, como en las imágenes del diseño, y un contraluz del color del estado.
    this.escena.add(new HemisphereLight(0xdfe7ff, 0x1a1530, 1.4))
    this.escena.add(new AmbientLight(0xffffff, 0.35))
    const clave = new DirectionalLight(0xffffff, 1.8)
    clave.position.set(1.2, 1.6, 2.4)
    this.escena.add(clave)
    this.contraluz = new DirectionalLight(this.colorLuz, 1.6)
    this.contraluz.position.set(-1.5, 0.8, -1.8)
    this.escena.add(this.contraluz)
    this.escena.add(this.pivote)

    this.escucharGestos()
    new ResizeObserver(() => this.ajustarTamano()).observe(contenedor)
    document.addEventListener('visibilitychange', () => this.fijarVisible(!document.hidden))
  }

  /** Carga el modelo; si falla (sin WebGL, GLB dañado…), rechaza y la interfaz usa el personaje dibujado. */
  static async crear(contenedor: HTMLElement, recursos: RecursosModelo): Promise<Personaje3D> {
    const calibracion: CalibracionModelo = {
      lentes: { ...CALIBRACION_POR_DEFECTO.lentes, ...recursos.calibracion?.lentes },
      encuadre: { ...CALIBRACION_POR_DEFECTO.encuadre, ...recursos.calibracion?.encuadre },
      giro: { ...CALIBRACION_POR_DEFECTO.giro, ...recursos.calibracion?.giro },
      cuello: recursos.calibracion?.cuello ?? CALIBRACION_POR_DEFECTO.cuello
    }
    const p = new Personaje3D(contenedor, calibracion)
    try {
      await p.cargar(recursos.glb, recursos.detalles)
      return p
    } catch (e) {
      p.destruir()
      throw e
    }
  }

  private async cargar(glb: Uint8Array, detalles?: RecursosModelo['detalles']): Promise<void> {
    const cargador = new GLTFLoader()
    cargador.setMeshoptDecoder(MeshoptDecoder)
    const datos = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer
    const gltf = await cargador.parseAsync(datos, '')
    const modelo: Object3D = gltf.scene
    modelo.rotation.set(this.calibracion.giro.x, this.calibracion.giro.y, 0)
    const [pelo, tejido] = await Promise.all([
      detalles?.pelo ? texturaDetalle(detalles.pelo).catch(() => undefined) : undefined,
      detalles?.tejido ? texturaDetalle(detalles.tejido).catch(() => undefined) : undefined
    ])
    const { lentes } = this.calibracion
    modelo.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      this.triangulos += (m.geometry.index?.count ?? m.geometry.attributes['position']?.count ?? 0) / 3
      aplicarDetalle(m, {
        ...(pelo ? { pelo } : {}),
        ...(tejido ? { tejido } : {}),
        cuello: this.calibracion.cuello ?? 0.36,
        gafas: { y0: 1 - lentes.y - lentes.alto * 0.6, y1: 1 - lentes.y + lentes.alto * 0.45, x: lentes.x + lentes.ancho * 0.55 }
      })
    })

    // Centrar y escalar a 1 de alto, con la base en y = 0: así el encuadre y las gafas no dependen del modelo.
    const caja = new Box3().setFromObject(modelo)
    const tam = caja.getSize(new Vector3())
    const escala = 1 / Math.max(tam.y, 1e-6)
    modelo.scale.setScalar(escala)
    caja.setFromObject(modelo)
    const centro = caja.getCenter(new Vector3())
    modelo.position.sub(new Vector3(centro.x, caja.min.y, centro.z))
    this.pivote.add(modelo)
    this.pivote.updateMatrixWorld(true)
    caja.setFromObject(modelo)

    this.colocarLentes(modelo, caja)
    this.encuadrar(caja)
    this.ajustarTamano()
    this.iniciar()
  }

  /**
   * Busca la superficie de los cristales lanzando un rayo desde delante a la altura de cada uno, y pone encima una
   * pantalla transparente donde se dibujan los ojos de luz.
   */
  private colocarLentes(modelo: Object3D, caja: Box3): void {
    const { lentes } = this.calibracion
    const ancho = caja.max.x - caja.min.x
    const alto = caja.max.y - caja.min.y
    const y = caja.max.y - lentes.y * alto
    const rayo = new Raycaster()
    for (const lado of [-1, 1]) {
      const x = lado * lentes.x * ancho
      // El cristal es curvo y la pantalla plana: se pone delante del punto más saliente de todo el cristal (no solo
      // del centro), o la parte que sobresale tapa medio ojo con un corte vertical.
      let zMax = -Infinity
      for (let i = 0; i <= 4; i++) {
        for (let j = 0; j <= 2; j++) {
          const px = x + (i / 4 - 0.5) * lentes.ancho * ancho * 0.9
          const py = y + (j / 2 - 0.5) * lentes.alto * alto * 0.9
          rayo.set(new Vector3(px, py, caja.max.z + 1), new Vector3(0, 0, -1))
          const impacto = rayo.intersectObject(modelo, true)[0]
          if (impacto) zMax = Math.max(zMax, impacto.point.z)
        }
      }
      const z = (Number.isFinite(zMax) ? zMax : caja.max.z) + 0.004
      const lienzo = document.createElement('canvas')
      lienzo.width = 192
      lienzo.height = 96
      const textura = new CanvasTexture(lienzo)
      textura.colorSpace = SRGBColorSpace
      const material = new MeshBasicMaterial({ map: textura, transparent: true, depthWrite: false, blending: AdditiveBlending })
      const malla = new Mesh(new PlaneGeometry(lentes.ancho * ancho, lentes.alto * alto), material)
      malla.position.set(x, y, z)
      malla.renderOrder = 2
      this.pivote.add(malla)
      this.lentes.push({ malla, lienzo, textura })
    }
  }

  /** La cámara mira al busto entero, centrado, con un poco de margen para respirar y botar. */
  private encuadrar(caja: Box3): void {
    const { encuadre } = this.calibracion
    const alto = (caja.max.y - caja.min.y) * (encuadre.abajo - encuadre.arriba)
    const centroY = caja.max.y - (caja.max.y - caja.min.y) * ((encuadre.arriba + encuadre.abajo) / 2)
    const distancia = (alto * 1.12) / (2 * Math.tan((this.camara.fov * Math.PI) / 360))
    this.camara.position.set(0, centroY, caja.max.z + distancia)
    this.camara.lookAt(0, centroY, 0)
  }

  private ajustarTamano(): void {
    const r = this.contenedor.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const lado = Math.max(1, Math.round(Math.min(r.width, r.height)))
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(lado, lado, false)
    this.capaAdornos.width = Math.round(lado * dpr)
    this.capaAdornos.height = Math.round(lado * dpr)
    this.camara.aspect = 1
    this.camara.updateProjectionMatrix()
  }

  // -------------------------------------------------------------------------------------------
  // Avatar
  // -------------------------------------------------------------------------------------------

  establecerEstado(estado: EstadoOrbe): void {
    this.director.establecerEstado(estado)
    this.colorObjetivo.set(COLOR_ESTADO[estado])
  }
  obtenerEstado(): EstadoOrbe {
    return this.director.obtenerEstado()
  }
  pulso(intensidad = 0.5): void {
    this.pulsoEnergia = Math.min(1, this.pulsoEnergia + intensidad)
  }
  expresar(id: IdExpresion | null, duracionMs = 2500): void {
    this.director.expresar(id, duracionMs)
  }
  /** La que toca ahora (no la del último fotograma dibujado: con un equipo lento puede ir por detrás). */
  expresionActual(): IdExpresion | null {
    return this.director.actual()
  }
  mirarA(x: number, y: number): void {
    const anterior = this.cursor
    this.cursor = { x, y, cuando: performance.now() }
    if (anterior && (anterior.x !== x || anterior.y !== y)) this.director.reaccionar('despertar')
  }
  gesto(id: IdGesto, conCara = false): void {
    this.director.gesticular(id, conCara)
  }
  reaccionar(reaccion: Reaccion): void {
    this.director.reaccionar(reaccion)
  }
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
    const info = this.renderer.info
    return {
      figura: '3d',
      estado: this.director.obtenerEstado(),
      expresion: this.director.actual(),
      dibujada: this.expresion,
      dormido: this.director.estaDormido(),
      fps: Math.round(this.fps),
      triangulos: Math.round(this.triangulos),
      texturas: info.memory.textures,
      geometrias: info.memory.geometries,
      mirada: { x: Math.round(this.mirada.x * 100) / 100, y: Math.round(this.mirada.y * 100) / 100 }
    }
  }

  /** Libera la GPU (al cambiar de figura o si falla la carga). */
  destruir(): void {
    this.detener()
    this.escena.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      m.geometry.dispose()
      const materiales = Array.isArray(m.material) ? m.material : [m.material]
      for (const mat of materiales) {
        for (const valor of Object.values(mat)) if (valor && typeof valor === 'object' && 'isTexture' in valor) (valor as { dispose(): void }).dispose()
        mat.dispose()
      }
    })
    this.renderer.dispose()
    this.canvas.remove()
    this.capaAdornos.remove()
  }

  private escucharGestos(): void {
    let ultimo: { x: number; y: number } | null = null
    this.contenedor.addEventListener('pointerenter', () => this.director.reaccionar('encima'))
    this.contenedor.addEventListener('pointerleave', () => {
      ultimo = null
      this.director.reaccionar('fuera')
    })
    this.contenedor.addEventListener('pointermove', (e) => {
      if (e.buttons !== 0) return
      if (ultimo) this.director.moverEncima(Math.hypot(e.screenX - ultimo.x, e.screenY - ultimo.y))
      ultimo = { x: e.screenX, y: e.screenY }
    })
    this.contenedor.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.director.siguiente(e.deltaY > 0 ? 1 : -1)
      },
      { passive: false }
    )
  }

  // -------------------------------------------------------------------------------------------
  // Animación
  // -------------------------------------------------------------------------------------------

  private readonly bucle = (ahora: number): void => {
    this.idRaf = requestAnimationFrame(this.bucle)
    const quieto = this.director.obtenerEstado() === 'reposo' && this.pulsoEnergia < 0.01
    if (ahora - this.ultimoDibujo < 1000 / (quieto ? 30 : 60) - 2) return
    this.ultimoDibujo = ahora
    const dt = Math.min(0.1, (ahora - this.ultimoTick) / 1000)
    this.ultimoTick = ahora
    this.t += dt
    this.cuadros++
    if (ahora - this.marcaFps >= 1000) {
      this.fps = (this.cuadros * 1000) / (ahora - this.marcaFps)
      this.cuadros = 0
      this.marcaFps = ahora
    }
    this.actualizar(ahora, dt)
    this.renderer.render(this.escena, this.camara)
  }

  private actualizar(ahora: number, dt: number): void {
    const id = this.director.actual()
    if (id !== this.expresion) {
      this.expresion = id
      this.cambioForma = ahora
      this.contenedor.dataset['expresion'] = id
    }
    const objetivo = EXPRESIONES[id]
    if (objetivo !== this.formaVisible && ahora - this.cambioForma > 70) this.formaVisible = objetivo
    const meta = caraNumerica(objetivo)
    for (const k of Object.keys(meta) as Array<keyof CaraNumerica>) this.cara[k] = suavizar(this.cara[k], meta[k], dt, 0.1)

    if (ahora > this.proximoParpadeo) {
      this.proximoParpadeo = ahora + 2200 + Math.random() * 4000
      this.parpadeo = 0
    }
    this.parpadeo = Math.min(1, this.parpadeo + dt * 8)
    if (ahora - this.cambioForma < 140) this.parpadeo = Math.min(this.parpadeo, Math.abs(ahora - this.cambioForma - 70) / 70)

    // Mirada: el cursor si se movió hace poco; si no, la de la expresión o un paseo tranquilo.
    let meta2 = { x: 0, y: 0 }
    if (this.cursor && ahora - this.cursor.cuando < 4000) {
      const r = this.contenedor.getBoundingClientRect()
      const dx = this.cursor.x - (window.screenX + r.left + r.width / 2)
      const dy = this.cursor.y - (window.screenY + r.top + r.height / 2)
      meta2 = { x: dx / (Math.abs(dx) + 160), y: dy / (Math.abs(dy) + 160) }
    } else if (this.director.obtenerEstado() === 'leyendo') {
      meta2 = { x: Math.sin(this.t * 2.4) * 0.8, y: 0.2 }
    } else if (objetivo.mirada) {
      meta2 = objetivo.mirada
    } else {
      if (ahora > this.paseo.proximo) this.paseo = { x: (Math.random() - 0.5) * 0.6, y: (Math.random() - 0.5) * 0.3, proximo: ahora + 2000 + Math.random() * 3500 }
      meta2 = this.paseo
    }
    this.mirada.x = suavizar(this.mirada.x, meta2.x, dt, 0.12)
    this.mirada.y = suavizar(this.mirada.y, meta2.y, dt, 0.12)
    this.pulsoEnergia = Math.max(0, this.pulsoEnergia - dt * 1.6)

    // Cuerpo: gira la cabeza hacia donde mira, respira, bota y se ladea según la expresión.
    const c = this.cara
    const bote = (c.bote * 0.5 + this.pulsoEnergia * 0.7) * Math.abs(Math.sin(this.t * 7))
    const respira = Math.sin(this.t * 1.7) * 0.012
    // Gestos (saludar, saltar, bailar…): el modelo es de una pieza, así que se mueve, gira y estira entero.
    const g = this.director.gestoActual()
    this.pose = g ? poseGesto(g.id, g.progreso) : POSE_NEUTRA
    const p = this.pose
    const alto = this.altoModelo
    this.pivote.rotation.set(
      this.mirada.y * 0.18 + p.rotX,
      this.mirada.x * 0.42 + p.rotY,
      (-(c.inclinacion + Math.sin(this.t * 0.9) * 1.2) * Math.PI) / 180 + p.rotZ
    )
    this.pivote.position.set(p.posX * alto, bote * 0.035 + p.posY * alto, 0)
    this.pivote.scale.set((1 + respira * 0.4) * p.escalaX, (1 + respira) * p.escalaY, (1 + respira * 0.4) * p.escalaX)

    this.colorLuz.lerp(this.colorObjetivo, Math.min(1, dt * 4))
    this.contraluz.color.copy(this.colorLuz)
    this.contraluz.intensity = 1.3 + this.pulsoEnergia * 1.2 + Math.sin(this.t * 2) * 0.1

    this.dibujarLentes()
    this.dibujarAdornos()
  }

  /** Los ojos de luz de las gafas: solo se repintan si algo cambió (ahorra CPU en reposo). */
  private dibujarLentes(): void {
    const forma = this.formaVisible
    const c = this.cara
    const color = `#${this.colorLuz.getHexString()}`
    const firma = [forma.ojos, forma.guino, c.curva.toFixed(2), c.apertura.toFixed(2), c.pupila.toFixed(2), c.cejas.toFixed(1), c.alturaCejas.toFixed(1), c.cejaAsimetrica.toFixed(1), this.parpadeo.toFixed(2), this.mirada.x.toFixed(2), this.mirada.y.toFixed(2), color, forma.ojos === 'normal' ? '' : Math.floor(this.t * 12)].join('|')
    if (firma === this.ultimaFirmaLed) return
    this.ultimaFirmaLed = firma
    this.lentes.forEach((lente, i) => {
      const ctx = lente.lienzo.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, lente.lienzo.width, lente.lienzo.height)
      // i = 0 es el cristal de la izquierda en pantalla: el ojo derecho del personaje (el del guiño va a la izquierda).
      dibujarOjoLed(ctx, lente.lienzo.width, lente.lienzo.height, {
        forma: forma.guino && i === 0 ? 'feliz' : forma.ojos,
        apertura: c.apertura * (forma.ojos === 'normal' ? this.parpadeo : 1),
        pupila: c.pupila,
        cejas: i === 0 ? -c.cejas : c.cejas,
        alturaCejas: c.alturaCejas + (i === 1 ? c.cejaAsimetrica : 0),
        mirada: this.mirada,
        color,
        t: this.t,
        espejo: i === 1,
        curva: c.curva
      })
      lente.textura.needsUpdate = true
    })
  }

  private dibujarAdornos(): void {
    const ctx = this.capaAdornos.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, this.capaAdornos.width, this.capaAdornos.height)
    dibujarAdorno(ctx, this.formaVisible.adorno, this.t, this.capaAdornos.width)
    if (this.pose.mano !== null) dibujarMano(ctx, this.capaAdornos.width, this.pose.mano)
  }
}
