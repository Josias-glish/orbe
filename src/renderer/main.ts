import { enCentroPersonaje, zonaInteractiva } from './zona-raton'
import './estilos.css'
import type { EstadoOrbe, EstadoVentana } from '../shared/tipos'
import { FondoChat } from './chat/fondo-ui'
import { PanelChat } from './chat/panel'
import { Orbe } from './orbe/orbe'
import type { Apariencia } from '../shared/tipos'
import { FiguraEsquina } from './personaje/figura'
import { MenuPersonaje } from './personaje/menu-personaje'
import { Personaje } from './personaje/personaje'
import { Sonidos, type Sonido } from './personaje/sonidos'
import { disenoPorId } from '../shared/disenos'

const UMBRAL_ARRASTRE = 4
/** Elementos que reciben sus propios clics: no deben iniciar un arrastre de la ventana. */
const INTERACTIVOS = 'button, a, input, textarea, summary, [data-no-arrastre]'

const raiz = document.getElementById('raiz') as HTMLDivElement
const caja = document.getElementById('orbe-caja') as HTMLDivElement
const canvas = document.getElementById('orbe-canvas') as HTMLCanvasElement
const cabecera = document.getElementById('panel-cabecera') as HTMLElement
const panelEl = document.getElementById('panel') as HTMLElement

// La figura de la esquina: el personaje por defecto; el orbe clásico o un personaje de Rive si así se configuró.
const orbe = new FiguraEsquina()
let apariencia: Apariencia = 'personaje'

let diseno = 'orbi'

function ponerPersonaje(): void {
  canvas.hidden = true
  caja.classList.add('con-personaje')
  orbe.poner(new Personaje(caja, disenoPorId(diseno)))
}

async function montarFigura(): Promise<void> {
  let recursos: Awaited<ReturnType<typeof window.orbe.personajeRecursos>> = { apariencia: 'personaje', diseno: 'orbi' }
  try {
    recursos = await window.orbe.personajeRecursos()
  } catch {
    // sin respuesta, el personaje de siempre
  }
  apariencia = recursos.apariencia
  diseno = recursos.diseno
  if (recursos.apariencia === 'orbe') {
    try {
      orbe.poner(new Orbe(canvas))
      return
    } catch {
      apariencia = 'personaje' // sin WebGL2, el personaje (que es SVG) funciona igual
    }
  }
  if (recursos.apariencia === '3d' && recursos.modelo3d) {
    try {
      canvas.hidden = true
      caja.classList.add('con-personaje', 'con-3d')
      const { Personaje3D } = await import('./personaje/personaje-3d')
      orbe.poner(await Personaje3D.crear(caja, recursos.modelo3d))
      return
    } catch (e) {
      console.warn('[orbe] Personaje 3D no disponible:', e)
      caja.classList.remove('con-3d')
      apariencia = 'personaje'
    }
  }
  if (recursos.apariencia === 'rive' && recursos.rive) {
    try {
      canvas.hidden = true
      caja.classList.add('con-personaje')
      const { PersonajeRive } = await import('./personaje/personaje-rive')
      orbe.poner(await PersonajeRive.crear(caja, recursos.rive))
      return
    } catch (e) {
      console.warn('[orbe] Personaje de Rive no disponible:', e)
      apariencia = 'personaje'
    }
  }
  if (recursos.aviso) console.warn('[orbe]', recursos.aviso)
  ponerPersonaje()
}

// Sonidos del personaje (WebAudio, sin archivos). Se apagan desde el menú del personaje.
let almacenSonidos: Storage | null = null
try {
  almacenSonidos = window.localStorage
} catch {
  // sin almacenamiento, encendidos hasta cerrar Orbe
}
const sonidos = new Sonidos(almacenSonidos)
const SONIDO_DEL_PERSONAJE: Record<string, Sonido> = { caricia: 'caricia', rueda: 'rueda', dormir: 'dormir', despertar: 'despertar' }
document.addEventListener('orbe-personaje', (e) => {
  const s = SONIDO_DEL_PERSONAJE[(e as CustomEvent<string>).detail]
  if (s && apariencia !== 'orbe') sonidos.tocar(s)
})
document.addEventListener('orbe-estado', (e) => {
  const { anterior, estado } = (e as CustomEvent<{ anterior: string; estado: string }>).detail
  if (estado === 'pensando' && anterior === 'reposo') sonidos.tocar('enviar')
  else if (estado === 'reposo' && anterior === 'respondiendo') sonidos.tocar('respuesta')
})
window.orbe.alActividad((evento) => {
  if (evento.tipo === 'esperando') sonidos.tocar('aviso')
  else if (evento.tipo === 'terminado') sonidos.tocar('terminado')
  else if (evento.tipo === 'error') sonidos.tocar('error')
})

// El entorno del equipo: si te vas, se duerme; al volver, se alegra; sin enchufe, se preocupa.
window.orbe.alEntorno((evento) => {
  switch (evento) {
    case 'ausente':
    case 'bloqueo':
    case 'suspension':
      orbe.reaccionar('ausente')
      sonidos.tocar('dormir')
      break
    case 'vuelve':
    case 'desbloqueo':
    case 'reanudacion':
      orbe.reaccionar('vuelve')
      window.setTimeout(() => orbe.expresar('risa', 1800), 950)
      break
    case 'bateria':
      orbe.expresar('preocupado', 3500)
      sonidos.tocar('aviso')
      break
    case 'corriente':
      orbe.expresar('feliz', 2000)
      break
  }
})

const figuraLista = montarFigura().then(() => {
  // Un saludo al arrancar, según la hora: con sueño de madrugada, guiño por la tarde, contento por la mañana.
  const hora = new Date().getHours()
  window.setTimeout(() => {
    orbe.expresar(hora >= 23 || hora < 6 ? 'aburrido' : hora >= 13 ? 'guino' : 'feliz', 2500)
    orbe.gesto?.(hora >= 23 || hora < 6 ? 'estirarse' : 'saludo')
  }, 600)
  menuPersonaje = new MenuPersonaje(
    orbe,
    document.getElementById('personaje-boton') as HTMLButtonElement,
    document.getElementById('personaje-menu') as HTMLElement,
    document.getElementById('actividad-insignia') as HTMLElement,
    apariencia !== 'orbe',
    sonidos
  )
})
let menuPersonaje: MenuPersonaje | null = null
window.orbe.alCursor((p) => orbe.mirarA(p.x, p.y))
const panel = new PanelChat(orbe)
void panel.restaurarConversacion()
const fondo = new FondoChat(
  document.getElementById('fondo') as HTMLElement,
  document.getElementById('fondo-boton') as HTMLButtonElement,
  document.getElementById('fondo-menu') as HTMLElement,
  panelEl
)
void fondo.iniciar()

/** Distingue clic de arrastre sobre un elemento: el arrastre mueve la ventana, el clic ejecuta `alClic`. */
function hacerArrastrable(elemento: HTMLElement, alClic?: () => void, gestos?: { alEmpezar(): void; alSoltar(): void }): void {
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
      gestos?.alEmpezar()
      window.orbe.arrastreInicio(inicio.x, inicio.y)
    }
    window.orbe.arrastreMover(e.screenX, e.screenY)
  })

  const terminar = (e: PointerEvent): void => {
    if (!inicio) return
    if (elemento.hasPointerCapture(e.pointerId)) elemento.releasePointerCapture(e.pointerId)
    if (arrastrando) {
      window.orbe.arrastreFin()
      gestos?.alSoltar()
    } else if (e.type === 'pointerup') alClic?.()
    inicio = null
    arrastrando = false
    elemento.classList.remove('arrastrando')
  }
  elemento.addEventListener('pointerup', terminar)
  elemento.addEventListener('pointercancel', terminar)
}

/** Los agarres de los bordes cambian el tamaño del panel; el orbe se queda en su esquina. */
function hacerRedimensionable(agarre: HTMLElement): void {
  const modo = agarre.dataset['modo'] as 'x' | 'y' | 'xy'
  let activo = false
  agarre.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    try {
      agarre.setPointerCapture(e.pointerId)
    } catch {
      // sin captura el arrastre funciona igual mientras el puntero siga encima
    }
    activo = true
    window.orbe.redimensionarInicio(e.screenX, e.screenY, modo)
  })
  agarre.addEventListener('pointermove', (e) => {
    if (activo) window.orbe.redimensionarMover(e.screenX, e.screenY)
  })
  const terminar = (e: PointerEvent): void => {
    if (!activo) return
    activo = false
    if (agarre.hasPointerCapture(e.pointerId)) agarre.releasePointerCapture(e.pointerId)
    window.orbe.redimensionarFin()
  }
  agarre.addEventListener('pointerup', terminar)
  agarre.addEventListener('pointercancel', terminar)
}

// Un clic sobre el personaje NO abre el chat (se tocaba sin querer): solo reacciona con un gesto. El chat se abre
// con doble clic, con Ctrl+Mayús+Espacio o desde la bandeja.
let clicPendiente = 0
const CLICS_JUGAR = ['salto', 'saludo', 'giro', 'baile', 'asentir'] as const
function alClicPersonaje(): void {
  if (clicPendiente) {
    window.clearTimeout(clicPendiente)
    clicPendiente = 0
    window.orbe.alternar()
    return
  }
  clicPendiente = window.setTimeout(() => {
    clicPendiente = 0
    orbe.gesto?.(CLICS_JUGAR[Math.floor(Math.random() * CLICS_JUGAR.length)], true)
    sonidos.tocar('risa')
  }, 280)
}

hacerArrastrable(caja, alClicPersonaje, {
  alEmpezar: () => {
    orbe.reaccionar('arrastre')
    sonidos.tocar('sorpresa')
  },
  alSoltar: () => {
    orbe.reaccionar('soltar')
    sonidos.tocar('risa')
  }
})
hacerArrastrable(cabecera)
document.querySelectorAll<HTMLElement>('.agarre').forEach(hacerRedimensionable)

// Solo el centro del personaje (y el panel abierto) recibe el ratón: el resto de la ventana transparente deja pasar
// los clics a las ventanas y pestañas de debajo. Windows sigue mandando los movimientos aunque la ventana los ignore,
// y así se sabe cuándo volver a recibirlo.
let interactivo: boolean | null = null
let botonesPulsados = false
function revisarZona(e: MouseEvent): void {
  botonesPulsados = e.buttons !== 0
  const objetivo = e.target instanceof Element ? e.target : null
  const expandido = raiz.classList.contains('expandido')
  const dentro = zonaInteractiva({
    arrastrando: botonesPulsados || caja.classList.contains('arrastrando') || cabecera.classList.contains('arrastrando'),
    sobrePanel: expandido && (objetivo?.closest('#panel') ?? null) !== null,
    sobreBoton: (objetivo?.closest('#detener-orbe, #actividad-insignia') ?? null) !== null,
    enCentro: enCentroPersonaje(e.clientX, e.clientY, caja.getBoundingClientRect())
  })
  if (dentro === interactivo) return
  interactivo = dentro
  caja.classList.toggle('raton-fuera', !dentro)
  window.orbe.ratonInteractivo(dentro)
}
document.addEventListener('mousemove', revisarZona, { passive: true })
document.addEventListener('mouseleave', () => {
  if (botonesPulsados || interactivo === false) return
  interactivo = false
  window.orbe.ratonInteractivo(false)
})
// Al arrancar el puntero suele estar lejos: la ventana empieza sin tapar nada.
window.orbe.ratonInteractivo(false)
interactivo = false

let primeraApertura = true
/** Para que «cerrar» no suene al arrancar (el panel empieza plegado). */
let yaAbierto = false

function aplicarEstadoVentana(estado: EstadoVentana): void {
  raiz.classList.toggle('expandido', estado.expandido)
  raiz.classList.toggle('colapsado', !estado.expandido)
  raiz.classList.toggle('ancla-derecha', estado.ancla.horizontal === 'derecha')
  raiz.classList.toggle('ancla-izquierda', estado.ancla.horizontal === 'izquierda')
  raiz.classList.toggle('ancla-abajo', estado.ancla.vertical === 'abajo')
  raiz.classList.toggle('ancla-arriba', estado.ancla.vertical === 'arriba')
  panelEl.setAttribute('aria-hidden', String(!estado.expandido))

  if (!estado.expandido && yaAbierto) sonidos.tocar('cerrar')
  yaAbierto = estado.expandido
  if (estado.expandido) {
    // Abrir el panel es la señal de que se va a usar: se prepara el chat y se deja el cursor listo.
    orbe.reaccionar('abrir')
    sonidos.tocar('abrir')
    if (primeraApertura) {
      primeraApertura = false
      window.orbe.chatPrecalentar()
    }
    window.setTimeout(() => panel.enfocar(), 60)
    window.setTimeout(() => panel.alAbrirPanel(), 400)
  }
}

window.orbe.alCambiarExpandido(aplicarEstadoVentana)
// Ventana oculta (bandeja o atajo): se pausa la animación para no gastar GPU.
window.orbe.alCambiarVisibilidad((visible) => orbe.fijarVisible(visible))

// Escape cierra el gestor de memoria si está abierto y, si no, el panel.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !raiz.classList.contains('expandido')) return
  if (fondo.cerrarMenuSiAbierto() || menuPersonaje?.cerrarSiAbierto() || panel.alPulsarEscape()) return
  window.orbe.alternar()
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
w.__orbeFiguraLista = () => figuraLista.then(() => true)

// El selector de estados solo existe con el servidor de desarrollo (npm run dev); Ctrl+Alt+D lo muestra u oculta.
if (location.protocol === 'http:') {
  const barra = document.getElementById('depuracion') as HTMLDivElement
  for (const estado of ['reposo', 'leyendo', 'pensando', 'respondiendo', 'escuchando', 'actuando'] as EstadoOrbe[]) {
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
