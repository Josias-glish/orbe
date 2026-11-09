import type { OrigenTextoImagen } from '../../shared/tipos'
import { registrarMenu } from './menus'

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (clase) e.className = clase
  if (texto !== undefined) e.textContent = texto
  return e
}

const OPCIONES: Array<{ origen: OrigenTextoImagen; titulo: string; ayuda: string }> = [
  { origen: 'ventana', titulo: 'De la ventana', ayuda: 'La que estabas usando. Sin pantallazo: Orbe no se oculta.' },
  { origen: 'portapapeles', titulo: 'Del portapapeles', ayuda: 'Copia antes una imagen (clic derecho → Copiar imagen, o Win+Mayús+S).' },
  { origen: 'archivo', titulo: 'De un archivo…', ayuda: 'PNG, JPG, BMP, GIF o TIFF.' }
]

/**
 * El menú del botón «Texto de imagen»: elige de dónde sacar la imagen cuyo texto reconoce Windows en el propio
 * equipo. Solo viaja el texto (y solo si envías el mensaje); la imagen no sale de tu ordenador.
 */
export class MenuTextoImagen {
  private readonly menus: { anunciarApertura(): void }

  constructor(
    private readonly boton: HTMLButtonElement,
    private readonly menu: HTMLElement,
    private readonly alElegir: (origen: OrigenTextoImagen) => void
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
    const titulo = el('p', 'ocr-menu-titulo', 'Leer el texto de una imagen')
    const nota = el('p', 'memoria-nota', 'Lo reconoce Windows en tu equipo: solo viaja el texto, y solo si envías el mensaje.')
    const botones = OPCIONES.map(({ origen, titulo: t, ayuda }) => {
      const b = el('button', 'ocr-opcion')
      b.type = 'button'
      b.dataset['origen'] = origen
      b.setAttribute('role', 'menuitem')
      b.append(el('span', 'ocr-opcion-titulo', t), el('span', 'ocr-opcion-ayuda', ayuda))
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        this.cerrar()
        this.alElegir(origen)
      })
      return b
    })
    this.menu.replaceChildren(titulo, ...botones, nota)
    this.menu.hidden = false
    this.boton.setAttribute('aria-expanded', 'true')
    botones[0]?.focus()
  }

  private cerrar(): void {
    this.menu.hidden = true
    this.boton.setAttribute('aria-expanded', 'false')
  }
}
