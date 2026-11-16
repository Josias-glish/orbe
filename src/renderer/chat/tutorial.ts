import type { IdExpresion } from '../../shared/expresiones'
import type { Avatar } from '../personaje/avatar'
import type { IdGesto } from '../personaje/gestos'

/**
 * El recorrido guiado para quien abre Orbe por primera vez: oscurece el panel, deja a la vista el control real de cada
 * paso y le pone al lado un bocadillo con «Atrás», «Siguiente» y «Saltar». Se ve una sola vez (localStorage); se repite
 * escribiendo «tutorial» o desde la configuración.
 */
export interface PasoTutorial {
  /** Selector de lo que se ilumina (varios a la vez con coma); null = bocadillo centrado. */
  objetivo: string | null
  titulo: string
  texto: string
  cara: IdExpresion
  gesto?: IdGesto
}

export const PASOS: PasoTutorial[] = [
  {
    objetivo: null,
    titulo: 'Hola, soy Orbe',
    texto: 'Te enseño el panel en un minuto. Avanza con los botones o las flechas; Esc lo cierra cuando quieras.',
    cara: 'feliz',
    gesto: 'saludo'
  },
  {
    objetivo: '#entrada',
    titulo: 'Aquí me escribes',
    texto: 'Pídeme lo que necesites y pulsa Enter. Lo que haga en tu equipo depende de los permisos que me des.',
    cara: 'curioso'
  },
  {
    objetivo: '#leer, #capturar, #texto-imagen',
    titulo: 'Ver lo que tienes delante',
    texto: 'El ojo lee la ventana que tienes abierta; la cámara hace una captura (antes te pide permiso); el tercero lee el texto o la fórmula de una imagen. Solo miro cuando tú lo pulsas.',
    cara: 'concentrado'
  },
  {
    objetivo: '#microfono, #investigar-boton',
    titulo: 'Dictar e investigar',
    texto: 'El micrófono dicta en lugar de escribir. La lupa investiga a fondo: te propone un plan, consulta varias fuentes y te entrega un informe con citas.',
    cara: 'pensativo'
  },
  {
    objetivo: '#auto-boton',
    titulo: 'Modo auto',
    texto: 'Encendido, hago las tareas sin pedirte permiso en cada paso. Los pagos y las compras siempre te los consulto.',
    cara: 'emocionado'
  },
  {
    objetivo: '#privado-boton',
    titulo: 'Privado',
    texto: 'Con el candado hablas solo con el modelo local de tu PC: nada sale a internet, sin herramientas y sin memoria.',
    cara: 'timido'
  },
  {
    objetivo: '#potencia-boton',
    titulo: 'Potencia',
    texto: 'Más potencia piensa mejor, pero tarda más y gasta más. Para el día a día basta el nivel medio.',
    cara: 'concentrado'
  },
  {
    objetivo: '#historial-boton, #nueva',
    titulo: 'Tus conversaciones',
    texto: 'El reloj abre las conversaciones anteriores; el lápiz empieza una nueva.',
    cara: 'neutral'
  },
  {
    objetivo: '#tareas-boton',
    titulo: 'Tareas',
    texto: 'Lo que hago por mi cuenta: en curso, programadas y terminadas.',
    cara: 'orgulloso'
  },
  {
    objetivo: '#memoria-boton',
    titulo: 'Memoria',
    texto: 'Lo que sé de ti. Puedes verlo, corregirlo o borrarlo; escribe «recuerda que…» para añadir algo.',
    cara: 'enamorado'
  },
  {
    objetivo: '#personaje-boton',
    titulo: 'Agentes',
    texto: 'Quién está trabajando y en qué, y los avisos que te doy.',
    cara: 'curioso'
  },
  {
    objetivo: '#metricas-boton',
    titulo: 'Métricas',
    texto: 'Cómo crecen tus cuentas de Instagram, si las conectas.',
    cara: 'emocionado'
  },
  {
    objetivo: '#ajustes-boton',
    titulo: 'Configuración',
    texto: 'La IA, la voz, el personaje y los conectores. Las claves se guardan en tu equipo y nunca vuelven a mostrarse. Aquí también puedes repetir este tutorial.',
    cara: 'guino'
  },
  {
    objetivo: '#cerrar-boton',
    titulo: 'Cerrar sin irme',
    texto: 'La X recoge el panel y me quedo en la esquina: haz doble clic sobre mí para volver. Para salir del todo, usa mi icono junto al reloj de Windows.',
    cara: 'feliz'
  },
  {
    objetivo: null,
    titulo: '¡Listo!',
    texto: 'Prueba a preguntarme «¿qué puedes hacer por mí?». Si quieres repetir esto, escribe «tutorial».',
    cara: 'emocionado',
    gesto: 'baile'
  }
]

export const CLAVE_VISTO = 'orbe.tutorial.visto'

/** «tutorial», «ver el tutorial», «repite el tutorial»… sin gastar una llamada al modelo. */
export function pideTutorial(texto: string): boolean {
  return /^\s*(?:(?:ver|ve|repite|repetir|abre|abrir|enséñame|empieza|iniciar)\s+(?:el\s+)?)?tutorial\s*[.!?]*\s*$/i.test(texto)
}

export interface Caja {
  x: number
  y: number
  ancho: number
  alto: number
}

const MARGEN = 12

/**
 * Dónde va el bocadillo, en coordenadas del panel: a la derecha si lo iluminado está en el carril de la izquierda,
 * debajo si cabe, si no encima; siempre dentro del panel. Sin objetivo, centrado.
 */
export function colocarBocadillo(objetivo: Caja | null, panel: { ancho: number; alto: number }, bocadillo: { ancho: number; alto: number }): { x: number; y: number } {
  const limitar = (v: number, max: number): number => Math.max(MARGEN, Math.min(v, max - MARGEN))
  if (!objetivo) return { x: Math.max(MARGEN, (panel.ancho - bocadillo.ancho) / 2), y: Math.max(MARGEN, (panel.alto - bocadillo.alto) / 2) }
  const enCarril = objetivo.x + objetivo.ancho < 70
  if (enCarril && objetivo.x + objetivo.ancho + MARGEN + bocadillo.ancho <= panel.ancho - MARGEN) {
    return { x: objetivo.x + objetivo.ancho + MARGEN, y: limitar(objetivo.y + objetivo.alto / 2 - bocadillo.alto / 2, panel.alto - bocadillo.alto) }
  }
  const x = limitar(objetivo.x + objetivo.ancho / 2 - bocadillo.ancho / 2, panel.ancho - bocadillo.ancho)
  const abajo = objetivo.y + objetivo.alto + MARGEN
  if (abajo + bocadillo.alto <= panel.alto - MARGEN) return { x, y: abajo }
  return { x, y: Math.max(MARGEN, objetivo.y - MARGEN - bocadillo.alto) }
}

/** El recuadro que abarca todo lo iluminado. */
export function unirCajas(cajas: Caja[]): Caja | null {
  if (cajas.length === 0) return null
  const x = Math.min(...cajas.map((c) => c.x))
  const y = Math.min(...cajas.map((c) => c.y))
  const fin = Math.max(...cajas.map((c) => c.x + c.ancho))
  const pie = Math.max(...cajas.map((c) => c.y + c.alto))
  return { x, y, ancho: fin - x, alto: pie - y }
}

export function tutorialVisto(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_VISTO) === '1'
  } catch {
    return true // sin almacenamiento, mejor no insistir en cada apertura
  }
}

function marcarVisto(): void {
  try {
    window.localStorage.setItem(CLAVE_VISTO, '1')
  } catch {
    // sin almacenamiento local se podría repetir: no pasa nada
  }
}

export class Tutorial {
  private capa: HTMLDivElement | null = null
  private foco!: HTMLDivElement
  private bocadillo!: HTMLDivElement
  private pasos: PasoTutorial[] = []
  private indice = 0
  private readonly teclas = (e: KeyboardEvent): void => this.alPulsarTecla(e)

  constructor(
    private readonly panel: HTMLElement,
    private readonly orbe: Avatar,
    private readonly alTerminar: () => void
  ) {}

  get abierto(): boolean {
    return this.capa !== null
  }

  iniciar(): void {
    if (this.capa) return
    // Solo los pasos cuyo control se ve ahora mismo (p. ej. sin «Métricas» si está oculto).
    this.pasos = PASOS.filter((p) => !p.objetivo || this.cajasDe(p.objetivo).length > 0)
    this.indice = 0
    this.capa = document.createElement('div')
    this.capa.className = 'tutorial'
    this.foco = document.createElement('div')
    this.foco.className = 'tutorial-foco'
    this.bocadillo = document.createElement('div')
    this.bocadillo.className = 'tutorial-bocadillo'
    this.bocadillo.setAttribute('role', 'dialog')
    this.bocadillo.setAttribute('aria-modal', 'true')
    this.bocadillo.setAttribute('aria-labelledby', 'tutorial-titulo')
    this.bocadillo.setAttribute('aria-describedby', 'tutorial-texto')
    this.capa.append(this.foco, this.bocadillo)
    this.panel.append(this.capa)
    // En fase de captura: Esc y las flechas son del tutorial mientras está abierto (no cierran el panel).
    window.addEventListener('keydown', this.teclas, true)
    this.pintar()
  }

  cerrar(): void {
    if (!this.capa) return
    window.removeEventListener('keydown', this.teclas, true)
    this.capa.remove()
    this.capa = null
    marcarVisto()
    this.orbe.expresar(null)
    this.alTerminar()
  }

  siguiente(): void {
    if (this.indice >= this.pasos.length - 1) this.cerrar()
    else this.ir(this.indice + 1)
  }

  anterior(): void {
    if (this.indice > 0) this.ir(this.indice - 1)
  }

  private ir(indice: number): void {
    this.indice = indice
    this.pintar()
  }

  private cajasDe(selector: string): Caja[] {
    const base = this.panel.getBoundingClientRect()
    return [...this.panel.querySelectorAll<HTMLElement>(selector)]
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x: r.left - base.left, y: r.top - base.top, ancho: r.width, alto: r.height }))
  }

  private pintar(): void {
    const paso = this.pasos[this.indice]
    if (!paso || !this.capa) return
    const ultimo = this.indice === this.pasos.length - 1

    const titulo = document.createElement('h3')
    titulo.id = 'tutorial-titulo'
    // Con una identidad propia (Atlas, Jarvis…) se presenta con su nombre, el de la cabecera.
    const nombre = this.panel.querySelector('.panel-titulo')?.textContent?.trim() || 'Orbe'
    titulo.textContent = paso.titulo.replace('Orbe', nombre)
    const texto = document.createElement('p')
    texto.id = 'tutorial-texto'
    texto.textContent = paso.texto
    const pie = document.createElement('div')
    pie.className = 'tutorial-pie'
    const cuenta = document.createElement('span')
    cuenta.className = 'tutorial-cuenta'
    cuenta.textContent = `${this.indice + 1} / ${this.pasos.length}`
    const boton = (clase: string, etiqueta: string, accion: () => void): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = `boton-memoria ${clase}`
      b.textContent = etiqueta
      b.addEventListener('click', accion)
      return b
    }
    const botones: HTMLButtonElement[] = []
    if (!ultimo) botones.push(boton('tutorial-saltar', 'Saltar', () => this.cerrar()))
    if (this.indice > 0) botones.push(boton('tutorial-atras', 'Atrás', () => this.anterior()))
    const avanzar = boton('tutorial-siguiente', ultimo ? 'Empezar' : 'Siguiente', () => this.siguiente())
    botones.push(avanzar)
    pie.append(cuenta, ...botones)
    this.bocadillo.replaceChildren(titulo, texto, pie)

    const base = this.panel.getBoundingClientRect()
    const caja = paso.objetivo ? unirCajas(this.cajasDe(paso.objetivo)) : null
    this.foco.hidden = caja === null
    this.capa.classList.toggle('sin-foco', caja === null)
    if (caja) {
      const holgura = 4
      Object.assign(this.foco.style, {
        left: `${caja.x - holgura}px`,
        top: `${caja.y - holgura}px`,
        width: `${caja.ancho + holgura * 2}px`,
        height: `${caja.alto + holgura * 2}px`
      })
    }
    const medida = this.bocadillo.getBoundingClientRect()
    const sitio = colocarBocadillo(caja, { ancho: base.width, alto: base.height }, { ancho: medida.width, alto: medida.height })
    this.bocadillo.style.left = `${sitio.x}px`
    this.bocadillo.style.top = `${sitio.y}px`

    // Orbe acompaña: pone la cara del paso, mira hacia lo iluminado y, en el primero y el último, hace un gesto.
    this.orbe.expresar(paso.cara, 0)
    if (caja) this.orbe.mirarA(window.screenX + base.left + caja.x + caja.ancho / 2, window.screenY + base.top + caja.y + caja.alto / 2)
    if (paso.gesto) this.orbe.gesto?.(paso.gesto)
    avanzar.focus()
  }

  private alPulsarTecla(e: KeyboardEvent): void {
    const acciones: Record<string, () => void> = {
      Escape: () => this.cerrar(),
      ArrowRight: () => this.siguiente(),
      ArrowLeft: () => this.anterior()
    }
    const accion = acciones[e.key]
    if (!accion) {
      // El foco no sale del bocadillo mientras dura el tutorial (Tab da la vuelta entre sus botones).
      if (e.key === 'Tab') {
        e.preventDefault()
        const botones = [...this.bocadillo.querySelectorAll('button')]
        const i = botones.indexOf(document.activeElement as HTMLButtonElement)
        botones[(i + (e.shiftKey ? -1 : 1) + botones.length) % botones.length]?.focus()
      }
      return
    }
    e.preventDefault()
    e.stopImmediatePropagation()
    accion()
  }
}
