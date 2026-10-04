import './estilos.css'
import type { EstadoOrbe, EstadoVentana } from '../shared/tipos'
import { Orbe } from './orbe/orbe'

const UMBRAL_ARRASTRE = 4

const raiz = document.getElementById('raiz') as HTMLDivElement
const caja = document.getElementById('orbe-caja') as HTMLDivElement
const canvas = document.getElementById('orbe-canvas') as HTMLCanvasElement
const cabecera = document.getElementById('panel-cabecera') as HTMLElement
const panel = document.getElementById('panel') as HTMLElement

const orbe = new Orbe(canvas)
orbe.iniciar()

/** Distingue clic de arrastre sobre un elemento: el arrastre mueve la ventana, el clic ejecuta `alClic`. */
function hacerArrastrable(elemento: HTMLElement, alClic?: () => void): void {
  let inicio: { x: number; y: number } | null = null
  let arrastrando = false

  elemento.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    elemento.setPointerCapture(e.pointerId)
    inicio = { x: e.screenX, y: e.screenY }
    arrastrando = false
  })

  elemento.addEventListener('pointermove', (e) => {
    if (!inicio) return
    if (!arrastrando) {
      if (Math.hypot(e.screenX - inicio.x, e.screenY - inicio.y) < UMBRAL_ARRASTRE) return
      arrastrando = true
      elemento.classList.add('arrastrando')
      window.orbe.arrastreInicio(inicio.x, inicio.y)
    }
    window.orbe.arrastreMover(e.screenX, e.screenY)
  })

  const terminar = (e: PointerEvent): void => {
    if (!inicio) return
    if (elemento.hasPointerCapture(e.pointerId)) elemento.releasePointerCapture(e.pointerId)
    if (arrastrando) window.orbe.arrastreFin()
    else if (e.type === 'pointerup') alClic?.()
    inicio = null
    arrastrando = false
    elemento.classList.remove('arrastrando')
  }
  elemento.addEventListener('pointerup', terminar)
  elemento.addEventListener('pointercancel', terminar)
}

hacerArrastrable(caja, () => window.orbe.alternar())
hacerArrastrable(cabecera)

function aplicarEstadoVentana(estado: EstadoVentana): void {
  raiz.classList.toggle('expandido', estado.expandido)
  raiz.classList.toggle('colapsado', !estado.expandido)
  raiz.classList.toggle('ancla-derecha', estado.ancla.horizontal === 'derecha')
  raiz.classList.toggle('ancla-izquierda', estado.ancla.horizontal === 'izquierda')
  raiz.classList.toggle('ancla-abajo', estado.ancla.vertical === 'abajo')
  raiz.classList.toggle('ancla-arriba', estado.ancla.vertical === 'arriba')
  panel.setAttribute('aria-hidden', String(!estado.expandido))
}

window.orbe.alCambiarExpandido(aplicarEstadoVentana)
// Ventana oculta (bandeja o atajo): se pausa la animación para no gastar GPU.
window.orbe.alCambiarVisibilidad((visible) => orbe.fijarVisible(visible))

// Ganchos para la prueba de humo y el selector de estados.
const w = window as unknown as Record<string, unknown>
let temporizadorPulsos = 0
w.__orbeEstado = (estado: EstadoOrbe): void => {
  orbe.establecerEstado(estado)
  window.clearInterval(temporizadorPulsos)
  // Simula el ritmo del streaming para poder ver las ondas sin conexión al modelo.
  if (estado === 'respondiendo') temporizadorPulsos = window.setInterval(() => orbe.pulso(0.45), 220)
}
w.__orbeDiagnostico = () => orbe.diagnostico()

// El selector de estados solo aparece con el servidor de desarrollo (npm run dev).
if (location.protocol === 'http:') {
  const barra = document.getElementById('depuracion') as HTMLDivElement
  barra.hidden = false
  for (const estado of ['reposo', 'leyendo', 'pensando', 'respondiendo'] as EstadoOrbe[]) {
    const boton = document.createElement('button')
    boton.textContent = estado
    boton.addEventListener('click', () => {
      ;(w.__orbeEstado as (e: EstadoOrbe) => void)(estado)
      barra.querySelectorAll('button').forEach((b) => b.classList.toggle('activo', b === boton))
    })
    barra.append(boton)
  }
}
