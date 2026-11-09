import type { Diseno, FormaCuerpo } from '../../shared/disenos'

const TAU = Math.PI * 2
const NS = 'http://www.w3.org/2000/svg'

/** Polígono regular de radio R con las esquinas redondeadas (mezclado con un círculo). */
function poligonoSuave(a: number, lados: number, giro: number, radio: number, redondez: number): number {
  const sector = TAU / lados
  const rel = ((((a - giro) % sector) + sector) % sector) - sector / 2
  const rp = (radio * Math.cos(Math.PI / lados)) / Math.cos(rel)
  return rp * (1 - redondez) + radio * Math.cos(Math.PI / lados) * 1.12 * redondez
}

/**
 * Los puntos del contorno del cuerpo (centrado en 0,0, unos 80 px de alto) para una forma y un instante: el cuerpo
 * es blando y tiembla un poco (`temblor`) para parecer vivo. Se cierran con una curva suave.
 */
export function puntosForma(forma: FormaCuerpo, t: number, temblor: number): Array<[number, number]> {
  const n = forma === 'corazon' || forma === 'fantasma' || forma === 'nube' ? 36 : 22
  const puntos: Array<[number, number]> = []
  const vivo = (a: number): number => 1 + temblor * Math.sin(3 * a + t * 2.1) + 0.012 * Math.sin(5 * a - t * 1.3)

  if (forma === 'corazon') {
    for (let i = 0; i < n; i++) {
      const u = (i / n) * TAU
      const x = 16 * Math.sin(u) ** 3
      const y = -(13 * Math.cos(u) - 5 * Math.cos(2 * u) - 2 * Math.cos(3 * u) - Math.cos(4 * u))
      const v = vivo(u)
      puntos.push([x * 2.45 * v, (y * 2.3 + 3) * v])
    }
    return puntos
  }
  if (forma === 'fantasma') {
    // Cabeza redonda, lados rectos y bajo ondulado que se mueve.
    const arriba = 14
    for (let i = 0; i <= arriba; i++) {
      const a = Math.PI + (i / arriba) * Math.PI
      puntos.push([Math.cos(a) * 37 * vivo(a), -4 + Math.sin(a) * 39 * vivo(a)])
    }
    puntos.push([37, 14])
    const ondas = 14
    for (let i = 0; i <= ondas; i++) {
      const x = 37 - (i / ondas) * 74
      puntos.push([x, 34 + Math.sin((i / ondas) * Math.PI * 4 + t * 3) * 4])
    }
    puntos.push([-37, 14])
    return puntos
  }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU
    let r = 40
    let ex = 1
    let ey = 0.97
    let dy = 1
    switch (forma) {
      case 'huevo':
        r = 40
        ex = 0.92 - 0.06 * Math.min(0, Math.sin(a))
        ey = 1.06
        break
      case 'nube':
        r = 35.5 + (Math.sin(a) < 0.35 ? 5.5 * Math.abs(Math.cos(3.2 * a + 0.3)) ** 0.7 : 1.5)
        ex = 1.14
        ey = 0.9
        dy = 3
        break
      case 'triangulo':
        r = poligonoSuave(a, 3, -Math.PI / 2, 52, 0.42)
        dy = 5
        break
      case 'cubo':
        r = poligonoSuave(a, 4, Math.PI / 4, 50, 0.32)
        ey = 0.95
        break
      case 'estrella':
        r = 41 * (0.83 + 0.17 * Math.cos(5 * (a + Math.PI / 2)))
        break
    }
    r *= vivo(a)
    puntos.push([Math.cos(a) * r * ex, Math.sin(a) * r * ey + dy])
  }
  return puntos
}

/** Lo más alto y lo más bajo del cuerpo en reposo (para colocar sombreros, bufandas…). */
export function medidasForma(forma: FormaCuerpo): { cima: number; base: number } {
  const p = puntosForma(forma, 0, 0)
  return { cima: Math.min(...p.map((q) => q[1])), base: Math.max(...p.map((q) => q[1])) }
}

function n<K extends keyof SVGElementTagNameMap>(etiqueta: K, atributos: Record<string, string | number>, padre: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, etiqueta)
  for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, String(v))
  padre.append(e)
  return e
}

/**
 * Dibuja el accesorio del diseño. `detras` queda tras el cuerpo (orejas, antenas), `delante` sobre él (sombreros,
 * bufandas) y `cara` se mueve con la cara (gafas).
 */
export function dibujarAccesorio(d: Diseno, capas: { detras: SVGGElement; delante: SVGGElement; cara: SVGGElement }): void {
  const { cima, base } = medidasForma(d.forma)
  const c = d.colorAccesorio
  const oscuro = 'rgba(15,10,40,0.55)'
  const { detras, delante, cara } = capas
  switch (d.accesorio) {
    case 'bufanda': {
      const y = Math.min(base - 14, 24)
      n('path', { d: `M-35 ${y - 4} Q0 ${y + 8} 35 ${y - 4} L34 ${y + 4} Q0 ${y + 16} -34 ${y + 4}Z`, fill: c, stroke: oscuro, 'stroke-width': 0.8 }, delante)
      n('path', { d: `M14 ${y + 6} l9 0 l3 18 l-9 1Z`, fill: c, stroke: oscuro, 'stroke-width': 0.8 }, delante)
      n('path', { d: `M-20 ${y + 1} Q0 ${y + 10} 20 ${y + 1}`, fill: 'none', stroke: 'rgba(255,255,255,0.45)', 'stroke-width': 2, 'stroke-dasharray': '4 4' }, delante)
      break
    }
    case 'auriculares':
      n('path', { d: `M-38 -2 Q-40 ${cima - 12} 0 ${cima - 10} Q40 ${cima - 12} 38 -2`, fill: 'none', stroke: c, 'stroke-width': 4.5, 'stroke-linecap': 'round' }, delante)
      for (const x of [-41, 41]) n('rect', { x: x - 6, y: -11, width: 12, height: 19, rx: 5, fill: c, stroke: 'rgba(255,255,255,0.25)', 'stroke-width': 1 }, delante)
      break
    case 'corona':
      n('path', { d: `M-15 ${cima + 3} L-17 ${cima - 13} L-8 ${cima - 5} L0 ${cima - 17} L8 ${cima - 5} L17 ${cima - 13} L15 ${cima + 3}Z`, fill: c, stroke: '#a16207', 'stroke-width': 1.2, 'stroke-linejoin': 'round' }, delante)
      for (const [x, col] of [[-9, '#ef4444'], [0, '#3b82f6'], [9, '#22c55e']] as const) n('circle', { cx: x, cy: cima - 2, r: 2, fill: col }, delante)
      break
    case 'antena':
      n('line', { x1: 0, y1: cima + 6, x2: 0, y2: cima - 13, stroke: '#64748b', 'stroke-width': 2.2, 'stroke-linecap': 'round' }, detras)
      n('circle', { cx: 0, cy: cima - 15, r: 4.5, fill: c, class: 'personaje-antena' }, detras)
      break
    case 'gorro':
      n('path', { d: `M-31 ${cima + 17} Q-30 ${cima - 9} 0 ${cima - 9} Q30 ${cima - 9} 31 ${cima + 17}Z`, fill: c, stroke: oscuro, 'stroke-width': 0.8 }, delante)
      n('rect', { x: -33, y: cima + 11, width: 66, height: 9, rx: 4.5, fill: c, stroke: 'rgba(255,255,255,0.5)', 'stroke-width': 1.5 }, delante)
      n('circle', { cx: 0, cy: cima - 11, r: 6, fill: '#fff' }, delante)
      break
    case 'aureola':
      n('ellipse', { cx: 0, cy: cima - 10, rx: 17, ry: 4.5, fill: 'none', stroke: c, 'stroke-width': 3.2, class: 'personaje-aureola' }, detras)
      break
    case 'orejas-conejo':
      for (const s of [-1, 1]) {
        const g = n('g', { transform: `rotate(${s * 13} ${s * 13} ${cima + 6})` }, detras)
        n('ellipse', { cx: s * 13, cy: cima - 13, rx: 7.5, ry: 19, fill: d.piel[1], stroke: d.piel[3], 'stroke-width': 0.8 }, g)
        n('ellipse', { cx: s * 13, cy: cima - 12, rx: 3.6, ry: 13, fill: c }, g)
      }
      break
    case 'orejas-gato':
      for (const s of [-1, 1]) {
        n('path', { d: `M${s * 30} ${cima + 14} L${s * 24} ${cima - 10} L${s * 8} ${cima + 4}Z`, fill: d.piel[2], stroke: d.piel[3], 'stroke-width': 0.8, 'stroke-linejoin': 'round' }, detras)
        n('path', { d: `M${s * 26} ${cima + 10} L${s * 23} ${cima - 3} L${s * 14} ${cima + 5}Z`, fill: c }, detras)
      }
      break
    case 'hoja':
      n('path', { d: `M0 ${cima + 3} Q-1 ${cima - 6} 2 ${cima - 10}`, fill: 'none', stroke: '#166534', 'stroke-width': 2, 'stroke-linecap': 'round' }, delante)
      n('path', { d: `M2 ${cima - 9} Q14 ${cima - 22} 22 ${cima - 12} Q12 ${cima - 3} 2 ${cima - 9}Z`, fill: c, stroke: '#14532d', 'stroke-width': 0.8 }, delante)
      break
    case 'chistera': {
      const g = n('g', { transform: `rotate(12 6 ${cima})` }, delante)
      n('ellipse', { cx: 6, cy: cima + 2, rx: 21, ry: 4.5, fill: c }, g)
      n('rect', { x: -7, y: cima - 22, width: 26, height: 24, rx: 2, fill: c }, g)
      n('rect', { x: -7, y: cima - 6, width: 26, height: 5, fill: '#e11d48' }, g)
      break
    }
    case 'lazo': {
      const x = 17
      const y = cima + 8
      n('path', { d: `M${x} ${y} Q${x - 15} ${y - 12} ${x - 13} ${y + 4}Z M${x} ${y} Q${x + 15} ${y - 12} ${x + 13} ${y + 4}Z`, fill: c, stroke: oscuro, 'stroke-width': 0.8, 'stroke-linejoin': 'round' }, delante)
      n('circle', { cx: x, cy: y - 1, r: 3.2, fill: c, stroke: oscuro, 'stroke-width': 0.8 }, delante)
      break
    }
    case 'pajarita': {
      const y = Math.min(base - 8, 32)
      n('path', { d: `M0 ${y} L-12 ${y - 7} L-12 ${y + 7}Z M0 ${y} L12 ${y - 7} L12 ${y + 7}Z`, fill: c, stroke: oscuro, 'stroke-width': 0.8, 'stroke-linejoin': 'round' }, delante)
      n('rect', { x: -3, y: y - 3.5, width: 6, height: 7, rx: 2, fill: c, stroke: oscuro, 'stroke-width': 0.8 }, delante)
      break
    }
    case 'gafas':
      for (const x of [-12.5, 12.5]) n('circle', { cx: x, cy: -3, r: 9.5, fill: 'rgba(255,255,255,0.08)', stroke: c, 'stroke-width': 2.2 }, cara)
      n('path', { d: 'M-3 -4 Q0 -7 3 -4', fill: 'none', stroke: c, 'stroke-width': 2.2 }, cara)
      break
    case 'flor': {
      const x = -17
      const y = cima + 7
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU
        n('circle', { cx: x + Math.cos(a) * 4.6, cy: y + Math.sin(a) * 4.6, r: 3.6, fill: c }, delante)
      }
      n('circle', { cx: x, cy: y, r: 2.8, fill: '#fde047' }, delante)
      break
    }
    case 'cuernos':
      for (const s of [-1, 1]) n('path', { d: `M${s * 12} ${cima + 6} Q${s * 14} ${cima - 10} ${s * 24} ${cima - 12} Q${s * 21} ${cima - 2} ${s * 21} ${cima + 8}Z`, fill: c, stroke: '#7f1d1d', 'stroke-width': 0.8 }, detras)
      break
    case 'gorra':
      n('path', { d: `M-30 ${cima + 15} Q-29 ${cima - 7} 0 ${cima - 7} Q29 ${cima - 7} 30 ${cima + 15}Z`, fill: c, stroke: oscuro, 'stroke-width': 0.8 }, delante)
      n('path', { d: `M14 ${cima + 12} Q36 ${cima + 8} 46 ${cima + 16} Q32 ${cima + 19} 14 ${cima + 16}Z`, fill: c, stroke: oscuro, 'stroke-width': 0.8 }, delante)
      n('circle', { cx: 0, cy: cima - 6, r: 2.2, fill: 'rgba(255,255,255,0.7)' }, delante)
      break
    case 'ninguno':
      break
  }
}
