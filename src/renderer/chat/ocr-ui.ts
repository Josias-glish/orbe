import type { OrigenTextoImagen } from '../../shared/tipos'
import { registrarMenu } from './menus'

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (clase) e.className = clase
  if (texto !== undefined) e.textContent = texto
  return e
}

/** Texto: lo lee Windows en tu equipo y solo viaja el texto. Fórmula: la IA ve la imagen para reconocerla y resolverla. */
export type ModoImagen = 'texto' | 'formula'

const OPCIONES: Array<{ origen: OrigenTextoImagen; titulo: string; ayuda: string }> = [
  { origen: 'ventana', titulo: 'De la ventana', ayuda: 'La que estabas usando. Sin pantallazo: Orbe no se oculta.' },
  { origen: 'portapapeles', titulo: 'Del portapapeles', ayuda: 'Copia antes una imagen (clic derecho → Copiar imagen, o Win+Mayús+S).' },
  { origen: 'archivo', titulo: 'De un archivo…', ayuda: 'PNG, JPG, BMP, GIF o TIFF.' }
]

const MODOS: Record<ModoImagen, { boton: string; titulo: string; nota: string }> = {
  texto: {
    boton: 'Texto',
    titulo: 'Leer el texto de una imagen',
    nota: 'Lo reconoce Windows en tu equipo: solo viaja el texto, y solo si envías el mensaje.'
  },
  formula: {
    boton: 'Fórmula o química',
    titulo: 'Reconocer y resolver una fórmula o una estructura química',
    nota: 'La IA verá la imagen (verás la miniatura antes) y la resolverá paso a paso. Necesita un modelo con visión.'
  }
}

/**
 * El menú del botón «Texto de imagen»: elige de dónde sacar la imagen cuyo texto reconoce Windows en el propio
 * equipo. Solo viaja el texto (y solo si envías el mensaje); la imagen no sale de tu ordenador.
 */
export class MenuTextoImagen {
  private readonly menus: { anunciarApertura(): void }
  private modo: ModoImagen = 'texto'

  constructor(
    private readonly boton: HTMLButtonElement,
    private readonly menu: HTMLElement,
    private readonly alElegir: (modo: ModoImagen, origen: OrigenTextoImagen) => void
  ) {
    this.menus = registrarMenu('texto-imagen', () => this.cerrar())
    boton.setAttribute('aria-haspopup', 'menu')
    boton.setAttribute('aria-expanded', 'false')
    boton.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.menu.hidden) this.abrir()
      else this.cerrar()
    })
    document.addEventListener('click', (e) => {
      if (!this.menu.hidden && !e.composedPath().includes(this.menu)) this.cerrar()
    })
  }

  get abierto(): boolean {
    return !this.menu.hidden
  }

  /** Esc: si el menú está abierto, lo cierra y devuelve true. */
  cerrarSiAbierto(): boolean {
    if (this.menu.hidden) return false
    this.cerrar()
    this.boton.focus()
    return true
  }

  private abrir(): void {
    this.menus.anunciarApertura()
    this.pintar()
    this.menu.hidden = false
    this.boton.setAttribute('aria-expanded', 'true')
    this.menu.querySelector<HTMLButtonElement>('.ocr-opcion')?.focus()
  }

  private pintar(): void {
    const modo = MODOS[this.modo]
    const selector = el('div', 'ocr-modos')
    selector.setAttribute('role', 'radiogroup')
    selector.setAttribute('aria-label', 'Qué hay en la imagen')
    for (const id of Object.keys(MODOS) as ModoImagen[]) {
      const b = el('button', 'ocr-modo', MODOS[id].boton)
      b.type = 'button'
      b.dataset['modo'] = id
      b.setAttribute('role', 'radio')
      b.setAttribute('aria-checked', String(id === this.modo))
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        if (this.modo === id) return
        this.modo = id
        this.pintar()
        this.menu.querySelector<HTMLButtonElement>(`.ocr-modo[data-modo="${id}"]`)?.focus()
      })
      selector.append(b)
    }
    const botones = OPCIONES.map(({ origen, titulo: t, ayuda }) => {
      const b = el('button', 'ocr-opcion')
      b.type = 'button'
      b.dataset['origen'] = origen
      b.setAttribute('role', 'menuitem')
      b.append(el('span', 'ocr-opcion-titulo', t), el('span', 'ocr-opcion-ayuda', this.modo === 'formula' && origen === 'archivo' ? 'PNG o JPG.' : ayuda))
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        this.cerrar()
        this.alElegir(this.modo, origen)
      })
      return b
    })
    this.menu.replaceChildren(selector, el('p', 'ocr-menu-titulo', modo.titulo), ...botones, el('p', 'memoria-nota', modo.nota))
  }

  private cerrar(): void {
    this.menu.hidden = true
    this.boton.setAttribute('aria-expanded', 'false')
  }
}
