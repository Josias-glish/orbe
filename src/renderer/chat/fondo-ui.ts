import type { EstadoFondo } from '../../shared/tipos'
import { registrarMenu } from './menus'

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (clase) e.className = clase
  if (texto !== undefined) e.textContent = texto
  return e
}

/**
 * El fondo del chat: una imagen de la carpeta del usuario detrás de los mensajes, con un velo oscuro para que
 * el texto se lea siempre. Un botón de la cabecera abre un menú para cambiar de imagen, apagarlo o ajustar cuánto se ve.
 */
export class FondoChat {
  private estado: EstadoFondo | null = null
  /** Para no repintar la imagen (cientos de KB) cuando solo cambia la visibilidad. */
  private imagenPuesta: string | null = null
  private readonly menus: { anunciarApertura(): void }

  constructor(
    private readonly capa: HTMLElement,
    private readonly boton: HTMLButtonElement,
    private readonly menu: HTMLElement,
    private readonly panel: HTMLElement
  ) {
    this.menus = registrarMenu('fondo', () => this.cerrarMenu())
    boton.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.menu.hidden) this.abrirMenu()
      else this.cerrarMenu()
    })
    // Un clic fuera del menú lo cierra.
    document.addEventListener('click', (e) => {
      if (!this.menu.hidden && !e.composedPath().includes(this.menu)) this.cerrarMenu()
    })
  }

  async iniciar(): Promise<void> {
    try {
      this.aplicar(await window.orbe.fondoEstado())
    } catch {
      this.boton.hidden = true
    }
  }

  /** Esc: si el menú está abierto, lo cierra y devuelve true (el panel se queda abierto). */
  cerrarMenuSiAbierto(): boolean {
    if (this.menu.hidden) return false
    this.cerrarMenu()
    return true
  }

  private abrirMenu(): void {
    this.menus.anunciarApertura()
    this.menu.hidden = false
    this.boton.setAttribute('aria-expanded', 'true')
    this.pintarMenu()
  }

  private cerrarMenu(): void {
    this.menu.hidden = true
    this.boton.setAttribute('aria-expanded', 'false')
  }

  /** Pone en pantalla un estado nuevo. `imagen: null` con el fondo activo significa «la misma de antes». */
  private aplicar(nuevo: EstadoFondo): void {
    const previo = this.estado
    const imagen = nuevo.imagen ?? (nuevo.activo && previo?.nombre === nuevo.nombre ? this.imagenPuesta : null)
    this.estado = { ...nuevo, imagen }

    this.boton.hidden = !nuevo.disponible
    const visible = nuevo.disponible && nuevo.activo && imagen !== null
    this.panel.classList.toggle('con-fondo', visible)
    if (visible && imagen !== this.imagenPuesta) {
      this.capa.style.backgroundImage = `url("${imagen}")`
      this.imagenPuesta = imagen
    }
    if (!visible) {
      this.capa.style.backgroundImage = ''
      this.imagenPuesta = null
    }
    this.capa.style.opacity = visible ? String(nuevo.visibilidad) : '0'
    if (!this.menu.hidden) this.pintarMenu()
  }

  private async cambiar(llamada: Promise<EstadoFondo>): Promise<void> {
    try {
      this.aplicar(await llamada)
    } catch {
      // Si el proceso principal no responde, se queda como estaba.
    }
  }

  private pintarMenu(): void {
    const e = this.estado
    if (!e) return

    const otro = el('button', 'boton-memoria', 'Otro fondo')
    otro.type = 'button'
    otro.addEventListener('click', () => void this.cambiar(window.orbe.fondoSiguiente()))

    const opcion = el('label', 'memoria-opcion')
    const casilla = el('input')
    casilla.type = 'checkbox'
    casilla.checked = e.activo
    casilla.addEventListener('change', () => void this.cambiar(window.orbe.fondoAjustar({ activo: casilla.checked })))
    opcion.append(casilla, el('span', undefined, 'Mostrar el fondo'))

    const visibilidad = el('label', 'fondo-visibilidad')
    const rango = el('input')
    rango.type = 'range'
    rango.min = '10'
    rango.max = '90'
    rango.step = '5'
    rango.value = String(Math.round(e.visibilidad * 100))
    rango.disabled = !e.activo
    rango.setAttribute('aria-label', 'Cuánto se ve el fondo')
    // Mientras se arrastra se ve al momento; el valor se guarda al soltar.
    rango.addEventListener('input', () => {
      this.capa.style.opacity = String(Number(rango.value) / 100)
    })
    rango.addEventListener('change', () => void this.cambiar(window.orbe.fondoAjustar({ visibilidad: Number(rango.value) / 100 })))
    visibilidad.append(el('span', undefined, 'Visibilidad'), rango)

    const detalle = el('p', 'memoria-nota', e.nombre ? `${e.nombre} · ${e.total} ${e.total === 1 ? 'imagen' : 'imágenes'}` : '')
    detalle.title = e.nombre ?? ''
    this.menu.replaceChildren(otro, opcion, visibilidad, detalle)
  }
}
