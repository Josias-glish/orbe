import type { Adorno, FormaOjos } from '../../shared/expresiones'

export interface OjoLed {
  forma: FormaOjos
  /** 0 = cerrado, 1 = normal, 1.25 = muy abierto. */
  apertura: number
  pupila: number
  /** Inclinación de la ceja en grados (ya con el signo de su lado). */
  cejas: number
  alturaCejas: number
  mirada: { x: number; y: number }
  color: string
  t: number
  /** El cristal derecho: las formas asimétricas (espiral) giran al revés. */
  espejo: boolean
  /** La sonrisa de la expresión (-1…1): sin boca, la mirada sonríe (media luna) o se entristece (párpado caído). */
  curva: number
}

function corazon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath()
  ctx.moveTo(x, y + s * 0.9)
  ctx.bezierCurveTo(x - s * 1.6, y - s * 0.1, x - s * 0.9, y - s * 1.3, x, y - s * 0.45)
  ctx.bezierCurveTo(x + s * 0.9, y - s * 1.3, x + s * 1.6, y - s * 0.1, x, y + s * 0.9)
  ctx.closePath()
}

function estrella(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, puntas = 5, interior = 0.45): void {
  ctx.beginPath()
  for (let i = 0; i < puntas * 2; i++) {
    const radio = i % 2 === 0 ? r : r * interior
    const a = -Math.PI / 2 + (i * Math.PI) / puntas
    const px = x + Math.cos(a) * radio
    const py = y + Math.sin(a) * radio
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

/**
 * Un ojo de luz en el cristal de las gafas (como una pantalla LED): las mismas formas que el personaje dibujado
 * (normal, feliz, cerrado, corazón, estrella, espiral), con brillo, parpadeo, mirada y una ceja de luz.
 */
export function dibujarOjoLed(ctx: CanvasRenderingContext2D, w: number, h: number, o: OjoLed): void {
  const cx = w / 2 + o.mirada.x * w * 0.13
  const cy = h * 0.56 + o.mirada.y * h * 0.12
  ctx.save()
  ctx.shadowColor = o.color
  ctx.shadowBlur = h * 0.16
  ctx.fillStyle = o.color
  ctx.strokeStyle = o.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = h * 0.1

  let forma = o.forma
  if (forma === 'normal' && o.apertura < 0.16) forma = 'cerrados'
  switch (forma) {
    case 'normal': {
      const rx = w * 0.15 * o.pupila
      const ry = Math.max(h * 0.05, h * 0.33 * o.apertura * (0.85 + 0.15 * o.pupila))
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.fill()
      // Sin boca, la mirada lleva la emoción: al sonreír, el ojo se vuelve media luna; triste, cae el párpado.
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.shadowBlur = 0
      if (o.curva > 0.3) {
        const k = Math.min(1, (o.curva - 0.3) / 0.6)
        ctx.beginPath()
        ctx.ellipse(cx, cy + ry * (1.55 - 0.55 * k), rx * 1.4, ry * 1.05, 0, 0, Math.PI * 2)
        ctx.fill()
      } else if (o.curva < -0.3) {
        const k = Math.min(1, (-o.curva - 0.3) / 0.6)
        const lado = o.espejo ? -1 : 1
        ctx.beginPath()
        ctx.moveTo(cx - rx * 1.3, cy - ry * 1.3)
        ctx.lineTo(cx + rx * 1.3, cy - ry * 1.3)
        ctx.lineTo(cx + rx * 1.3, cy - ry * (1 - 0.9 * k) + lado * ry * 0.5 * k)
        ctx.lineTo(cx - rx * 1.3, cy - ry * (1 - 0.9 * k) - lado * ry * 0.5 * k)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
      ctx.shadowBlur = 0
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.beginPath()
      ctx.arc(cx + rx * 0.35, cy - ry * 0.4, Math.min(rx, ry) * 0.26, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'feliz':
      ctx.beginPath()
      ctx.moveTo(cx - w * 0.15, cy + h * 0.1)
      ctx.quadraticCurveTo(cx, cy - h * 0.3, cx + w * 0.15, cy + h * 0.1)
      ctx.stroke()
      break
    case 'cerrados':
      ctx.beginPath()
      ctx.moveTo(cx - w * 0.15, cy)
      ctx.quadraticCurveTo(cx, cy + h * 0.15, cx + w * 0.15, cy)
      ctx.stroke()
      break
    case 'corazon': {
      ctx.fillStyle = ctx.shadowColor = '#ff4d8d'
      corazon(ctx, cx, cy, h * (0.3 + Math.sin(o.t * 6) * 0.02))
      ctx.fill()
      break
    }
    case 'estrella':
      ctx.fillStyle = ctx.shadowColor = '#fde047'
      estrella(ctx, cx, cy, h * (0.4 + Math.sin(o.t * 8) * 0.025))
      ctx.fill()
      break
    case 'espiral': {
      ctx.lineWidth = h * 0.05
      ctx.beginPath()
      const fase = o.t * 3.3 * (o.espejo ? -1 : 1)
      for (let i = 0; i <= 50; i++) {
        const k = i / 50
        const a = fase + k * Math.PI * 4.4
        const px = cx + Math.cos(a) * h * 0.3 * k
        const py = cy + Math.sin(a) * h * 0.3 * k
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
      break
    }
  }

  // Ceja de luz: solo cuando dice algo (enfado, pena, duda, sorpresa); en neutral, el cristal queda limpio.
  if (Math.abs(o.cejas) > 3 || Math.abs(o.alturaCejas) > 1.4) {
    ctx.shadowColor = o.color
    ctx.strokeStyle = o.color
    ctx.lineWidth = h * 0.06
    const by = h * 0.2 - o.alturaCejas * h * 0.025
    const angulo = (o.cejas * Math.PI) / 180
    const dx = Math.cos(angulo) * w * 0.14
    const dy = Math.sin(angulo) * w * 0.14
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    ctx.moveTo(cx - dx, by - dy)
    ctx.lineTo(cx + dx, by + dy)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Los adornos alrededor del personaje (corazones que suben, brillos, gota de sudor, lágrimas, zzz, «?», «!», enfado,
 * ideas) en una capa 2D sobre el 3D. Coordenadas como las del personaje dibujado: un cuadro de 120 × 120 centrado.
 */
export function dibujarAdorno(ctx: CanvasRenderingContext2D, adorno: Adorno, t: number, lado: number): void {
  if (adorno === 'ninguno') return
  const u = lado / 120
  const P = (x: number, y: number): [number, number] => [lado / 2 + x * u, lado / 2 + y * u]
  ctx.save()
  ctx.lineCap = 'round'
  const texto = (s: string, x: number, y: number, tam: number, color: string, alfa = 1): void => {
    ctx.globalAlpha = alfa
    ctx.font = `800 ${tam * u}px Inter, "Segoe UI", sans-serif`
    ctx.textAlign = 'center'
    ctx.lineWidth = 2.2 * u
    ctx.strokeStyle = 'rgba(10,8,30,0.85)'
    const [px, py] = P(x, y)
    ctx.strokeText(s, px, py)
    ctx.fillStyle = color
    ctx.fillText(s, px, py)
  }
  switch (adorno) {
    case 'corazones':
      for (let i = 0; i < 3; i++) {
        const p = (t * 0.45 + i / 3) % 1
        const [x, y] = P(-30 + i * 30 + Math.sin(t * 2 + i) * 3, -34 - p * 20)
        ctx.globalAlpha = 1 - p
        ctx.fillStyle = '#ff4d8d'
        corazon(ctx, x, y, (3.6 + p * 2) * u)
        ctx.fill()
      }
      break
    case 'brillos':
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + t * 0.6
        const [x, y] = P(Math.cos(a) * 48, Math.sin(a) * 46)
        ctx.fillStyle = '#fde68a'
        estrella(ctx, x, y, (2.5 + Math.abs(Math.sin(t * 3 + i * 1.7)) * 3.5) * u, 4, 0.3)
        ctx.fill()
      }
      break
    case 'sudor': {
      const p = (t * 0.5) % 1
      const [x, y] = P(30, -26 + p * 10)
      ctx.globalAlpha = p < 0.85 ? 1 : (1 - p) / 0.15
      ctx.fillStyle = '#38bdf8'
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.2 * u
      ctx.beginPath()
      ctx.moveTo(x, y - 6 * u)
      ctx.quadraticCurveTo(x + 5 * u, y + 1 * u, x, y + 5 * u)
      ctx.quadraticCurveTo(x - 5 * u, y + 1 * u, x, y - 6 * u)
      ctx.fill()
      ctx.stroke()
      break
    }
    case 'lagrimas':
      for (let i = 0; i < 4; i++) {
        const p = (t * 1.1 + (i % 2) * 0.5) % 1
        const lado2 = i < 2 ? -1 : 1
        const [x, y] = P(lado2 * (14 + p * 3), 6 + p * 28)
        ctx.globalAlpha = 1 - p * 0.8
        ctx.fillStyle = '#3b82f6'
        ctx.beginPath()
        ctx.ellipse(x, y, 2.2 * u, 3.2 * u, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    case 'zzz':
      for (let i = 0; i < 3; i++) {
        const p = (t * 0.35 + i / 3) % 1
        texto('z', 26 + p * 12 + i * 2, -24 - p * 26, 9 + i * 2, '#e0e7ff', Math.min(1, (1 - p) * 1.6))
      }
      break
    case 'interrogacion':
      texto('?', 34, -28 + Math.sin(t * 4) * 2, 18, '#fde047')
      break
    case 'exclamacion':
      texto('!', 34, -28 + Math.sin(t * 4) * 2, 19, '#fde047')
      break
    case 'enfado': {
      const s = (1 + Math.abs(Math.sin(t * 6)) * 0.25) * u
      const [x, y] = P(28, -30)
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 2.4 * u
      for (const [a, b, c2, d] of [[-5, -1, -1, -5], [1, -5, 5, -1], [5, 1, 1, 5], [-1, 5, -5, 1]]) {
        ctx.beginPath()
        ctx.moveTo(x + a * s, y + b * s)
        ctx.quadraticCurveTo(x, y, x + c2 * s, y + d * s)
        ctx.stroke()
      }
      break
    }
    case 'idea':
      for (let i = 0; i < 3; i++) {
        const [x, y] = P(28 + i * 6, -30 - i * 7)
        ctx.globalAlpha = 0.4 + 0.6 * Math.max(0, Math.sin(t * 3 - i * 0.9))
        ctx.fillStyle = '#e0e7ff'
        ctx.beginPath()
        ctx.arc(x, y, (1.6 + i * 0.9) * u, 0, Math.PI * 2)
        ctx.fill()
      }
      break
  }
  ctx.restore()
}
