import { DISENO_POR_DEFECTO, type Diseno } from '../../shared/disenos'
import { EXPRESIONES, caraNumerica, type CaraNumerica, type Expresion, type IdExpresion } from '../../shared/expresiones'
import type { EstadoOrbe } from '../../shared/tipos'
import { suavizar } from '../orbe/estados'
import type { Avatar, Reaccion } from './avatar'
import { Director } from './director'
import { dibujarAccesorio, puntosForma } from './formas'

const NS = 'http://www.w3.org/2000/svg'
const TAU = Math.PI * 2

/** Color del brillo según el estado de la conversación. */
const BRILLO: Record<EstadoOrbe, string> = {
  reposo: '#7c8cff',
  leyendo: '#5eead4',
  pensando: '#a78bfa',
  respondiendo: '#67e8f9',
  escuchando: '#f0abfc',
  actuando: '#38bdf8'
}

function nodo<K extends keyof SVGElementTagNameMap>(etiqueta: K, atributos: Record<string, string | number> = {}, padre?: Element): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, etiqueta)
  for (const [k, v] of Object.entries(atributos)) n.setAttribute(k, String(v))
  padre?.append(n)
  return n
}

const f = (n: number): string => (Math.round(n * 100) / 100).toString()

/** Curva cerrada suave (Catmull-Rom → Bézier) por una lista de puntos: el cuerpo blando del personaje. */
function curvaCerrada(puntos: Array<[number, number]>): string {
  const n = puntos.length
  let d = `M${f(puntos[0][0])} ${f(puntos[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = puntos[(i - 1 + n) % n]
    const p1 = puntos[i]
    const p2 = puntos[(i + 1) % n]
    const p3 = puntos[(i + 2) % n]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`
  }
  return `${d}Z`
}

function corazon(x: number, y: number, s: number): string {
  return `M${f(x)} ${f(y + s * 0.9)} C${f(x - s * 1.6)} ${f(y - s * 0.1)} ${f(x - s * 0.9)} ${f(y - s * 1.3)} ${f(x)} ${f(y - s * 0.45)} C${f(x + s * 0.9)} ${f(y - s * 1.3)} ${f(x + s * 1.6)} ${f(y - s * 0.1)} ${f(x)} ${f(y + s * 0.9)}Z`
}

function estrella(x: number, y: number, r: number, puntas = 5, interior = 0.45, giro = -Math.PI / 2): string {
  let d = ''
  for (let i = 0; i < puntas * 2; i++) {
    const radio = i % 2 === 0 ? r : r * interior
    const a = giro + (i * Math.PI) / puntas
    d += `${i === 0 ? 'M' : 'L'}${f(x + Math.cos(a) * radio)} ${f(y + Math.sin(a) * radio)}`
  }
  return `${d}Z`
}

function espiral(x: number, y: number, r: number, fase: number): string {
  let d = ''
  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    const a = fase + t * TAU * 2.2
    const radio = r * t
    d += `${i === 0 ? 'M' : 'L'}${f(x + Math.cos(a) * radio)} ${f(y + Math.sin(a) * radio)}`
  }
  return d
}

/**
 * El personaje de Orbe: una gota blanda con cara, dibujada con SVG (sin archivos externos ni conexión). Tiene 20
 * expresiones, parpadea, respira, sigue el cursor con la mirada, bota al responder, se duerme si no pasa nada y
 * reacciona si lo acaricias con el cursor, lo arrastras o giras la rueda encima. Sustituye al orbe por defecto; la
 * conversación no cambia.
 */
export class Personaje implements Avatar {
  private readonly director = new Director()
  private readonly svg: SVGSVGElement
  private readonly cuerpo: SVGGElement
  private readonly forma: SVGPathElement
  private readonly silueta: SVGPathElement
  private readonly brillo: SVGCircleElement
  private readonly halo: SVGStopElement
  private readonly anillo: SVGCircleElement
  private readonly cara: SVGGElement
  private readonly ojos: Array<{ grupo: SVGGElement; forma: SVGPathElement; reflejo: SVGCircleElement; reflejo2: SVGCircleElement }>
  private readonly cejas: SVGPathElement[]
  private readonly boca: SVGPathElement
  private readonly lengua: SVGPathElement
  private readonly mejillas: SVGEllipseElement[]
  private readonly adornos: SVGGElement

  private cara0: CaraNumerica = caraNumerica(EXPRESIONES.neutral)
  private expresion: IdExpresion = 'neutral'
  private formaVisible: Expresion = EXPRESIONES.neutral
  private mirada = { x: 0, y: 0 }
  private objetivoMirada = { x: 0, y: 0 }
  private cursor: { x: number; y: number; cuando: number } | null = null
  private paseo = { x: 0, y: 0, proximo: 0 }
  private parpadeo = 1
  private proximoParpadeo = performance.now() + 2500
  private cambioForma = 0
  private pulsoEnergia = 0
  private botePos = 0
  private t = Math.random() * 100

  private visible = true
  private idRaf = 0
  private ultimoTick = 0
  private ultimoDibujo = 0
  private marcaFps = 0
  private cuadrosFps = 0
  private fpsMedidos = 0

  constructor(
    private readonly contenedor: HTMLElement,
    private readonly diseno: Diseno = DISENO_POR_DEFECTO
  ) {
    const d = diseno
    // Cada personaje usa sus propios id de degradado (puede haber varios en la misma página, como en la galería).
    const sufijo = `${d.id}-${Math.random().toString(36).slice(2, 7)}`
    this.svg = nodo('svg', { viewBox: '-60 -60 120 120', class: 'personaje', 'aria-hidden': 'true' })
    this.svg.dataset['diseno'] = d.id
    const defs = nodo('defs', {}, this.svg)
    const gradiente = nodo('radialGradient', { id: `piel-${sufijo}`, cx: '0.36', cy: '0.3', r: '0.8' }, defs)
    d.piel.forEach((color, i) => nodo('stop', { offset: ['0', '0.38', '0.78', '1'][i], 'stop-color': color }, gradiente))
    const gHalo = nodo('radialGradient', { id: `halo-${sufijo}` }, defs)
    this.halo = nodo('stop', { offset: '0.5', 'stop-color': d.halo, 'stop-opacity': '0.55' }, gHalo)
    nodo('stop', { offset: '1', 'stop-color': d.halo, 'stop-opacity': '0' }, gHalo)

    this.brillo = nodo('circle', { cx: 0, cy: 2, r: 58, fill: `url(#halo-${sufijo})` }, this.svg)
    nodo('ellipse', { cx: 0, cy: 47, rx: 26, ry: 4.5, fill: 'rgba(8,10,30,0.35)', class: 'personaje-sombra' }, this.svg)
    this.anillo = nodo('circle', { cx: 0, cy: 0, r: 47, fill: 'none', stroke: '#7dd3fc', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-dasharray': '38 260', opacity: 0 }, this.svg)

    this.cuerpo = nodo('g', {}, this.svg)
    const detras = nodo('g', { class: 'personaje-detras' }, this.cuerpo)
    this.forma = nodo('path', { fill: `url(#piel-${sufijo})`, stroke: d.piel[3], 'stroke-opacity': '0.35', 'stroke-width': '0.8' }, this.cuerpo)
    // El brillo de arriba queda recortado por la silueta (en un triángulo o un corazón no se sale).
    const recorte = nodo('clipPath', { id: `silueta-${sufijo}` }, defs)
    this.silueta = nodo('path', {}, recorte)
    const brilloCuerpo = nodo('g', { 'clip-path': `url(#silueta-${sufijo})` }, this.cuerpo)
    nodo('ellipse', { cx: -13, cy: -18, rx: 12, ry: 7, fill: 'rgba(255,255,255,0.45)', transform: 'rotate(-28 -13 -18)' }, brilloCuerpo)

    this.cara = nodo('g', {}, this.cuerpo)
    this.mejillas = [-21, 21].map((x) => nodo('ellipse', { cx: x, cy: 7, rx: 6.5, ry: 4, fill: '#ff6fa8', opacity: 0 }, this.cara))
    this.ojos = [-12.5, 12.5].map((x) => {
      const grupo = nodo('g', { transform: `translate(${x} -3)` }, this.cara)
      const forma = nodo('path', { fill: d.rasgos, stroke: d.rasgos, 'stroke-width': 0, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, grupo)
      const reflejo = nodo('circle', { r: 2.2, fill: '#fff' }, grupo)
      const reflejo2 = nodo('circle', { r: 1, fill: '#fff', opacity: 0.8 }, grupo)
      return { grupo, forma, reflejo, reflejo2 }
    })
    this.cejas = [-12.5, 12.5].map(() => nodo('path', { fill: 'none', stroke: d.rasgos, 'stroke-width': 2.6, 'stroke-linecap': 'round', opacity: 0.85 }, this.cara))
    this.boca = nodo('path', { fill: d.rasgos, stroke: d.rasgos, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, this.cara)
    this.lengua = nodo('path', { fill: '#ff7aa8', opacity: 0 }, this.cara)
    const delante = nodo('g', { class: 'personaje-delante' }, this.cuerpo)
    dibujarAccesorio(d, { detras, delante, cara: this.cara })
    this.adornos = nodo('g', { class: 'personaje-adornos' }, this.svg)

    contenedor.append(this.svg)
    this.escucharGestos()
    document.addEventListener('visibilitychange', () => this.fijarVisible(!document.hidden))
  }

  // -------------------------------------------------------------------------------------------
  // Avatar
  // -------------------------------------------------------------------------------------------

  establecerEstado(estado: EstadoOrbe): void {
    if (estado === this.director.obtenerEstado()) return
    this.director.establecerEstado(estado)
    const color = estado === 'reposo' ? this.diseno.halo : BRILLO[estado]
    this.halo.setAttribute('stop-color', color)
    this.halo.nextElementSibling?.setAttribute('stop-color', color)
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

  expresionActual(): IdExpresion | null {
    return this.expresion
  }

  /** La expresión fijada desde el menú (o null). */
  expresionFijada(): IdExpresion | null {
    return this.director.fijadaActual()
  }

  mirarA(x: number, y: number): void {
    const anterior = this.cursor
    this.cursor = { x, y, cuando: performance.now() }
    if (anterior && (anterior.x !== x || anterior.y !== y)) this.director.reaccionar('despertar')
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
    return {
      figura: 'personaje',
      estado: this.director.obtenerEstado(),
      expresion: this.expresion,
      dormido: this.director.estaDormido(),
      mirada: { x: Math.round(this.mirada.x * 100) / 100, y: Math.round(this.mirada.y * 100) / 100 },
      fps: Math.round(this.fpsMedidos)
    }
  }

  // -------------------------------------------------------------------------------------------
  // Gestos del usuario sobre el personaje
  // -------------------------------------------------------------------------------------------

  private escucharGestos(): void {
    const caja = this.contenedor
    let ultimo: { x: number; y: number } | null = null
    caja.addEventListener('pointerenter', () => this.director.reaccionar('encima'))
    caja.addEventListener('pointerleave', () => {
      ultimo = null
      this.director.reaccionar('fuera')
    })
    caja.addEventListener('pointermove', (e) => {
      if (e.buttons !== 0) return
      if (ultimo) this.director.moverEncima(Math.hypot(e.screenX - ultimo.x, e.screenY - ultimo.y))
      ultimo = { x: e.screenX, y: e.screenY }
    })
    // La rueda encima del personaje recorre sus expresiones.
    caja.addEventListener(
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
    const estado = this.director.obtenerEstado()
    const fpsMax = estado === 'reposo' && this.pulsoEnergia < 0.01 ? 30 : 60
    if (ahora - this.ultimoDibujo < 1000 / fpsMax - 2) return
    this.ultimoDibujo = ahora
    const dt = Math.min(0.1, (ahora - this.ultimoTick) / 1000)
    this.ultimoTick = ahora
    this.t += dt
    this.medirFps(ahora)
    this.actualizar(ahora, dt)
    this.dibujar(ahora)
  }

  private medirFps(ahora: number): void {
    this.cuadrosFps++
    if (ahora - this.marcaFps >= 1000) {
      this.fpsMedidos = (this.cuadrosFps * 1000) / (ahora - this.marcaFps)
      this.cuadrosFps = 0
      this.marcaFps = ahora
    }
  }

  private actualizar(ahora: number, dt: number): void {
    const id = this.director.actual()
    if (id !== this.expresion) {
      this.expresion = id
      this.cambioForma = ahora
      this.svg.dataset['expresion'] = id
    }
    const objetivo = EXPRESIONES[id]
    // Las formas (ojos de corazón, boca en «o»…) cambian a mitad de un parpadeo rápido: así no se nota el salto.
    if (objetivo !== this.formaVisible && ahora - this.cambioForma > 70) this.formaVisible = objetivo
    const meta = caraNumerica(objetivo)
    for (const k of Object.keys(meta) as Array<keyof CaraNumerica>) this.cara0[k] = suavizar(this.cara0[k], meta[k], dt, 0.09)

    // Parpadeo: cada 2–6 s, más a menudo si está nervioso.
    if (ahora > this.proximoParpadeo) {
      this.proximoParpadeo = ahora + 2000 + Math.random() * 4000
      this.parpadeo = 0
    }
    if (ahora - this.cambioForma < 140) this.parpadeo = Math.min(this.parpadeo, Math.abs(ahora - this.cambioForma - 70) / 70)
    this.parpadeo = Math.min(1, this.parpadeo + dt * 9)

    // Mirada: el cursor si se ha movido hace poco; si no, la mirada propia de la expresión o un paseo tranquilo.
    const estado = this.director.obtenerEstado()
    if (this.cursor && ahora - this.cursor.cuando < 4000) {
      const r = this.contenedor.getBoundingClientRect()
      const dx = this.cursor.x - (window.screenX + r.left + r.width / 2)
      const dy = this.cursor.y - (window.screenY + r.top + r.height / 2)
      this.objetivoMirada = { x: dx / (Math.abs(dx) + 140), y: dy / (Math.abs(dy) + 140) }
    } else if (estado === 'leyendo') {
      this.objetivoMirada = { x: Math.sin(this.t * 2.4) * 0.8, y: 0.15 + (Math.floor(this.t * 0.6) % 3) * 0.12 }
    } else if (objetivo.mirada) {
      this.objetivoMirada = { ...objetivo.mirada }
    } else {
      if (ahora > this.paseo.proximo) this.paseo = { x: (Math.random() - 0.5) * 0.7, y: (Math.random() - 0.5) * 0.4, proximo: ahora + 1800 + Math.random() * 3500 }
      this.objetivoMirada = { x: this.paseo.x, y: this.paseo.y }
    }
    this.mirada.x = suavizar(this.mirada.x, this.objetivoMirada.x, dt, 0.08)
    this.mirada.y = suavizar(this.mirada.y, this.objetivoMirada.y, dt, 0.08)

    this.pulsoEnergia = Math.max(0, this.pulsoEnergia - dt * 1.6)
  }

  private dibujar(ahora: number): void {
    const c = this.cara0
    const forma = this.formaVisible
    const estado = this.director.obtenerEstado()
    const t = this.t

    // Cuerpo: respira, bota (más al hablar o si la expresión lo pide) y se ladea.
    const respira = Math.sin(t * 1.7) * 0.018
    const bote = (c.bote * 0.6 + this.pulsoEnergia * 0.8) * Math.abs(Math.sin(t * 7.5))
    this.botePos = suavizar(this.botePos, -bote * 7, 1 / 60, 0.04)
    const balanceo = Math.sin(t * 0.9) * 1.5
    this.cuerpo.setAttribute(
      'transform',
      `translate(0 ${f(this.botePos)}) rotate(${f(c.inclinacion + balanceo)}) scale(${f(1 + respira + bote * 0.03)} ${f(1 - respira - bote * 0.02)})`
    )
    const temblor = estado === 'pensando' ? 0.03 : 0.016
    const contorno = curvaCerrada(puntosForma(this.diseno.forma, t, temblor))
    this.forma.setAttribute('d', contorno)
    this.silueta.setAttribute('d', contorno)

    // Brillo y anillo de «actuando».
    const intensidad = estado === 'reposo' ? 0.55 : 0.85
    this.brillo.setAttribute('opacity', f(intensidad + this.pulsoEnergia * 0.3 + Math.sin(t * 2) * 0.05))
    if (estado === 'actuando') {
      this.anillo.setAttribute('opacity', '0.9')
      this.anillo.setAttribute('transform', `rotate(${f((t * 220) % 360)})`)
    } else this.anillo.setAttribute('opacity', '0')

    // La cara se desplaza un poco hacia donde mira (da sensación de volumen).
    this.cara.setAttribute('transform', `translate(${f(this.mirada.x * 3.5)} ${f(this.mirada.y * 2.5)})`)
    this.dibujarOjos(forma, c, ahora)
    this.dibujarCejas(c)
    this.dibujarBoca(forma, c)
    this.mejillas.forEach((m) => m.setAttribute('opacity', f(c.rubor * 0.6)))
    this.dibujarAdornos(forma.adorno, t)
  }

  private dibujarOjos(forma: Expresion, c: CaraNumerica, ahora: number): void {
    const px = this.mirada.x * 2.6
    const py = this.mirada.y * 2.2
    this.ojos.forEach((ojo, i) => {
      const guino = forma.guino && i === 0
      let tipo = guino ? 'feliz' : forma.ojos
      const apertura = Math.max(0, c.apertura * (tipo === 'normal' ? this.parpadeo : 1))
      if (tipo === 'normal' && apertura < 0.16) tipo = 'cerrados'
      const visibles = tipo === 'normal'
      ojo.reflejo.setAttribute('opacity', visibles ? '1' : '0')
      ojo.reflejo2.setAttribute('opacity', visibles ? '0.8' : '0')
      /** Relleno de color (o ninguno, para los ojos dibujados como un trazo) y su borde. */
      const rasgos = this.diseno.rasgos
      const pintar = (relleno: string | null, trazo = rasgos, grosor = relleno ? 0 : 2.8): void => {
        ojo.forma.setAttribute('fill', relleno ?? 'none')
        ojo.forma.setAttribute('stroke', trazo)
        ojo.forma.setAttribute('stroke-width', String(grosor))
      }
      switch (tipo) {
        case 'normal': {
          const rx = 5.6 * c.pupila
          const ry = 7.6 * apertura * (0.85 + 0.15 * c.pupila)
          ojo.forma.setAttribute('d', `M${f(px - rx)} ${f(py)} a${f(rx)} ${f(ry)} 0 1 0 ${f(rx * 2)} 0 a${f(rx)} ${f(ry)} 0 1 0 ${f(-rx * 2)} 0Z`)
          pintar(rasgos)
          ojo.reflejo.setAttribute('cx', f(px + 1.8))
          ojo.reflejo.setAttribute('cy', f(py - Math.min(3, ry * 0.4)))
          ojo.reflejo2.setAttribute('cx', f(px - 1.6))
          ojo.reflejo2.setAttribute('cy', f(py + Math.min(2.5, ry * 0.35)))
          break
        }
        case 'feliz':
          ojo.forma.setAttribute('d', `M-5.5 2 Q0 -5.5 5.5 2`)
          pintar(null)
          break
        case 'cerrados':
          ojo.forma.setAttribute('d', `M-5.5 0.5 Q0 3.5 5.5 0.5`)
          pintar(null)
          break
        case 'corazon': {
          const s = 5.2 + Math.sin(ahora / 160) * 0.5
          ojo.forma.setAttribute('d', corazon(px * 0.4, py * 0.4, s))
          pintar('#ff3d7f', '#7a1f4a', 0.8)
          break
        }
        case 'estrella':
          ojo.forma.setAttribute('d', estrella(px * 0.4, py * 0.4, 7 + Math.sin(ahora / 120) * 0.6))
          pintar('#fde047', '#b45309', 0.8)
          break
        case 'espiral':
          ojo.forma.setAttribute('d', espiral(0, 0, 6.5, (ahora / 300) * (i === 0 ? 1 : -1)))
          pintar(null, rasgos, 1.8)
          break
      }
    })
  }

  private dibujarCejas(c: CaraNumerica): void {
    this.cejas.forEach((ceja, i) => {
      const x = i === 0 ? -12.5 : 12.5
      const y = -15.5 - c.alturaCejas - (i === 1 ? c.cejaAsimetrica : 0) - (c.apertura - 1) * 4
      // Positivo = extremo interior arriba (pena); negativo = abajo (enfado).
      const angulo = ((i === 0 ? -c.cejas : c.cejas) * Math.PI) / 180
      const dx = Math.cos(angulo) * 4.8
      const dy = Math.sin(angulo) * 4.8
      ceja.setAttribute('d', `M${f(x - dx)} ${f(y - dy)} Q${f(x)} ${f(y - 1.4)} ${f(x + dx)} ${f(y + dy)}`)
      ceja.setAttribute('opacity', f(Math.min(0.9, 0.35 + Math.abs(c.cejas) / 20 + Math.abs(c.alturaCejas) / 6 + c.cejaAsimetrica / 6)))
    })
  }

  private dibujarBoca(forma: Expresion, c: CaraNumerica): void {
    const y = 12.5
    const w = 11 * c.anchoBoca
    const curva = c.curva * 7
    const abierta = c.aperturaBoca
    this.lengua.setAttribute('opacity', '0')
    switch (forma.boca) {
      case 'o': {
        const rx = 3.4 + c.anchoBoca * 1.4
        const ry = 2.6 + abierta * 4.5
        this.boca.setAttribute('d', `M${f(-rx)} ${f(y + 1)} a${f(rx)} ${f(ry)} 0 1 0 ${f(rx * 2)} 0 a${f(rx)} ${f(ry)} 0 1 0 ${f(-rx * 2)} 0Z`)
        this.boca.setAttribute('fill', this.diseno.rasgos)
        return
      }
      case 'ondulada': {
        const s = w / 4
        const yy = y + 1 - curva * 0.3
        this.boca.setAttribute('d', `M${f(-w / 2)} ${f(yy)} q${f(s / 2)} -2.6 ${f(s)} 0 t${f(s)} 0 t${f(s)} 0 t${f(s)} 0`)
        this.boca.setAttribute('fill', 'none')
        return
      }
      case 'plana':
        this.boca.setAttribute('d', `M${f(-w / 2)} ${f(y + 1)} Q0 ${f(y + 1 + curva * 0.5)} ${f(w / 2)} ${f(y + 1)}`)
        this.boca.setAttribute('fill', 'none')
        return
      default: {
        const comisura = y - curva * 0.35
        if (abierta < 0.06 && forma.boca !== 'lengua') {
          this.boca.setAttribute('d', `M${f(-w / 2)} ${f(comisura)} Q0 ${f(y + curva)} ${f(w / 2)} ${f(comisura)}`)
          this.boca.setAttribute('fill', 'none')
          return
        }
        // Boca abierta: labio de arriba y de abajo; la lengua asoma en el fondo.
        const fondo = y + curva + abierta * 10
        this.boca.setAttribute('d', `M${f(-w / 2)} ${f(comisura)} Q0 ${f(y + curva * 0.35)} ${f(w / 2)} ${f(comisura)} Q0 ${f(fondo + 2)} ${f(-w / 2)} ${f(comisura)}Z`)
        this.boca.setAttribute('fill', this.diseno.rasgos)
        if (forma.boca === 'lengua') {
          const lx = 2.5
          this.lengua.setAttribute('d', `M${f(lx - 4)} ${f(fondo - 3)} Q${f(lx - 4.5)} ${f(fondo + 5.5)} ${f(lx)} ${f(fondo + 5.5)} Q${f(lx + 4.5)} ${f(fondo + 5.5)} ${f(lx + 4)} ${f(fondo - 3)}Z`)
          this.lengua.setAttribute('opacity', '1')
        } else if (abierta > 0.3) {
          this.lengua.setAttribute('d', `M${f(-w / 4)} ${f(fondo - 0.5)} Q0 ${f(fondo - 4)} ${f(w / 4)} ${f(fondo - 0.5)} Q0 ${f(fondo + 1.5)} ${f(-w / 4)} ${f(fondo - 0.5)}Z`)
          this.lengua.setAttribute('opacity', '0.9')
        }
      }
    }
  }

  private adornoPintado: string = ''

  /** Los adornos se crean al cambiar y se animan cada cuadro con transformaciones baratas. */
  private dibujarAdornos(adorno: Expresion['adorno'], t: number): void {
    if (adorno !== this.adornoPintado) {
      this.adornoPintado = adorno
      this.adornos.replaceChildren()
      this.adornos.dataset['adorno'] = adorno
      const texto = (contenido: string, color: string, tam: number): SVGTextElement => {
        const n = nodo('text', { 'font-size': tam, 'font-weight': 800, fill: color, 'text-anchor': 'middle', 'font-family': 'Inter, Segoe UI, sans-serif', stroke: '#1b1440', 'stroke-width': 0.6 }, this.adornos)
        n.textContent = contenido
        return n
      }
      switch (adorno) {
        case 'corazones':
          for (let i = 0; i < 3; i++) nodo('path', { d: corazon(0, 0, 3.6), fill: '#ff4d8d' }, this.adornos)
          break
        case 'brillos':
          for (let i = 0; i < 4; i++) nodo('path', { d: estrella(0, 0, 4.5, 4, 0.3), fill: '#fde68a' }, this.adornos)
          break
        case 'sudor':
          nodo('path', { d: 'M0 -5 Q4 1 0 4 Q-4 1 0 -5Z', fill: '#38bdf8', stroke: '#fff', 'stroke-width': 1 }, this.adornos)
          break
        case 'lagrimas':
          for (let i = 0; i < 4; i++) nodo('path', { d: 'M0 -3 Q2.6 1 0 3 Q-2.6 1 0 -3Z', fill: '#3b82f6', stroke: '#fff', 'stroke-width': 0.7 }, this.adornos)
          break
        case 'zzz':
          for (let i = 0; i < 3; i++) texto('z', '#e0e7ff', 9 + i * 2)
          break
        case 'interrogacion':
          texto('?', '#fde047', 17)
          break
        case 'exclamacion':
          texto('!', '#fde047', 18)
          break
        case 'enfado':
          nodo('path', { d: 'M-5 -1 Q-1.5 -1.5 -1 -5 M1 -5 Q1.5 -1.5 5 -1 M5 1 Q1.5 1.5 1 5 M-1 5 Q-1.5 1.5 -5 1', fill: 'none', stroke: '#ef4444', 'stroke-width': 2.2, 'stroke-linecap': 'round' }, this.adornos)
          break
        case 'idea':
          for (let i = 0; i < 3; i++) nodo('circle', { r: 1.6 + i * 0.9, fill: '#e0e7ff' }, this.adornos)
          break
      }
    }
    const hijos = [...this.adornos.children] as SVGElement[]
    hijos.forEach((h, i) => {
      let x = 0
      let y = 0
      let o = 1
      let s = 1
      switch (adorno) {
        case 'corazones': {
          const p = (t * 0.45 + i / 3) % 1
          x = -30 + i * 30 + Math.sin(t * 2 + i) * 3
          y = -30 - p * 22
          o = 1 - p
          s = 0.8 + p * 0.5
          break
        }
        case 'brillos': {
          const a = (i / 4) * TAU + t * 0.6
          x = Math.cos(a) * 47
          y = Math.sin(a) * 45
          s = 0.5 + Math.abs(Math.sin(t * 3 + i * 1.7)) * 0.8
          break
        }
        case 'sudor': {
          const p = (t * 0.5) % 1
          x = 33
          y = -26 + p * 10
          o = p < 0.85 ? 1 : (1 - p) / 0.15
          break
        }
        case 'lagrimas': {
          const p = (t * 1.1 + (i % 2) * 0.5) % 1
          x = (i < 2 ? -14 : 14) + (i < 2 ? -1 : 1) * p * 3
          y = 3 + p * 30
          o = 1 - p * 0.8
          break
        }
        case 'zzz': {
          const p = (t * 0.35 + i / 3) % 1
          x = 26 + p * 12 + i * 2
          y = -24 - p * 26
          o = Math.min(1, (1 - p) * 1.6)
          break
        }
        case 'interrogacion':
        case 'exclamacion':
          x = 33
          y = -30 + Math.sin(t * 4) * 2
          s = 1 + Math.max(0, Math.sin(t * 8)) * 0.08
          break
        case 'enfado':
          x = 26
          y = -28
          s = 1 + Math.abs(Math.sin(t * 6)) * 0.25
          break
        case 'idea': {
          x = 28 + i * 6
          y = -30 - i * 7
          o = 0.4 + 0.6 * Math.max(0, Math.sin(t * 3 - i * 0.9))
          break
        }
      }
      h.setAttribute('transform', `translate(${f(x)} ${f(y)}) scale(${f(s)})`)
      h.setAttribute('opacity', f(o))
    })
  }
}
