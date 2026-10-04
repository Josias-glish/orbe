import './estilos.css'
import type { EstadoOrbe, EstadoVentana } from '../shared/tipos'
import { PanelChat } from './chat/panel'
import { Orbe } from './orbe/orbe'

const UMBRAL_ARRASTRE = 4
/** Elementos que reciben sus propios clics: no deben iniciar un arrastre de la ventana. */
const INTERACTIVOS = 'button, a, input, textarea, summary, [data-no-arrastre]'

const raiz = document.getElementById('raiz') as HTMLDivElement
const caja = document.getElementById('orbe-caja') as HTMLDivElement
const canvas = document.getElementById('orbe-canvas') as HTMLCanvasElement
const cabecera = document.getElementById('panel-cabecera') as HTMLElement
const panelEl = document.getElementById('panel') as HTMLElement

const orbe = new Orbe(canvas)
orbe.iniciar()
const panel = new PanelChat(orbe)

/** Distingue clic de arrastre sobre un elemento: el arrastre mueve la ventana, el clic ejecuta `alClic`. */
function hacerArrastrable(elemento: HTMLElement, alClic?: () => void): void {
  let inicio: { x: number; y: number } | null = null
  let arrastrando = false

  elemento.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest(INTERACTIVOS)) return
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

let primeraApertura = true

function aplicarEstadoVentana(estado: EstadoVentana): void {
  raiz.classList.toggle('expandido', estado.expandido)
  raiz.classList.toggle('colapsado', !estado.expandido)
  raiz.classList.toggle('ancla-derecha', estado.ancla.horizontal === 'derecha')
  raiz.classList.toggle('ancla-izquierda', estado.ancla.horizontal === 'izquierda')
  raiz.classList.toggle('ancla-abajo', estado.ancla.vertical === 'abajo')
  raiz.classList.toggle('ancla-arriba', estado.ancla.vertical === 'arriba')
  panelEl.setAttribute('aria-hidden', String(!estado.expandido))

  if (estado.expandido) {
    // Abrir el panel es la señal de que se va a usar: se prepara el chat y se deja el cursor listo.
    if (primeraApertura) {
      primeraApertura = false
      window.orbe.chatPrecalentar()
    }
    window.setTimeout(() => panel.enfocar(), 60)
  }
}

window.orbe.alCambiarExpandido(aplicarEstadoVentana)
// Ventana oculta (bandeja o atajo): se pausa la animación para no gastar GPU.
window.orbe.alCambiarVisibilidad((visible) => orbe.fijarVisible(visible))

// Escape cierra el panel.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && raiz.classList.contains('expandido')) window.orbe.alternar()
})

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

// El selector de estados solo existe con el servidor de desarrollo (npm run dev); Ctrl+Alt+D lo muestra u oculta.
if (location.protocol === 'http:') {
  const barra = document.getElementById('depuracion') as HTMLDivElement
  for (const estado of ['reposo', 'leyendo', 'pensando', 'respondiendo'] as EstadoOrbe[]) {
    const boton = document.createElement('button')
    boton.textContent = estado
    boton.addEventListener('click', () => {
      ;(w.__orbeEstado as (e: EstadoOrbe) => void)(estado)
      barra.querySelectorAll('button').forEach((b) => b.classList.toggle('activo', b === boton))
    })
    barra.append(boton)
  }
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'd') barra.hidden = !barra.hidden
  })
}
