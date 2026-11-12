import type { ConversacionArchivada, MensajeGuardado } from '../../shared/tipos'
import { registrarMenu } from './menus'

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (clase) e.className = clase
  if (texto !== undefined) e.textContent = texto
  return e
}

const fecha = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * El historial del chat: las conversaciones que se archivaron al pulsar «Nueva conversación». Al elegir una, se
 * reabre (la actual pasa al historial) y el modelo recibe su contexto con el próximo mensaje.
 */
export class MenuHistorial {
  private conversaciones: ConversacionArchivada[] = []
  private filtro = ''
  private readonly menus: { anunciarApertura(): void }

  constructor(
    private readonly boton: HTMLButtonElement,
    private readonly menu: HTMLElement,
    private readonly alAbrir: (mensajes: MensajeGuardado[]) => void
  ) {
    this.menus = registrarMenu('historial', () => this.cerrar())
    boton.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.menu.hidden) void this.abrir()
      else this.cerrar()
    })
    document.addEventListener('click', (e) => {
      if (!this.menu.hidden && !e.composedPath().includes(this.menu)) this.cerrar()
    })
  }

  cerrarSiAbierto(): boolean {
    if (this.menu.hidden) return false
    this.cerrar()
    return true
  }

  private async abrir(): Promise<void> {
    this.menus.anunciarApertura()
    try {
      this.conversaciones = await window.orbe.historialListar()
    } catch {
      this.conversaciones = []
    }
    this.filtro = ''
    this.menu.hidden = false
    this.boton.setAttribute('aria-expanded', 'true')
    this.pintar()
  }

  private cerrar(): void {
    this.menu.hidden = true
    this.boton.setAttribute('aria-expanded', 'false')
  }

  private pintar(): void {
    const titulo = el('p', 'potencia-titulo', 'Historial del chat')
    const buscar = el('input', 'historial-buscar')
    buscar.type = 'search'
    buscar.placeholder = 'Buscar en las conversaciones…'
    buscar.value = this.filtro
    buscar.setAttribute('aria-label', 'Buscar en el historial')
    const lista = el('div', 'historial-lista')
    let coinciden = new Set<string>()
    let pedido = 0
    const pintarLista = (): void => {
      const f = this.filtro.toLowerCase()
      const visibles = this.conversaciones.filter((c) => c.titulo.toLowerCase().includes(f) || coinciden.has(c.id))
      lista.replaceChildren(
        ...(visibles.length === 0
          ? [el('p', 'memoria-nota', this.conversaciones.length === 0 ? 'Aún no hay conversaciones guardadas. Se guardan al pulsar «Nueva conversación».' : 'Nada coincide.')]
          : visibles.map((c) => {
              const b = el('button', 'historial-item')
              b.type = 'button'
              b.append(el('span', 'historial-item-titulo', c.titulo), el('span', 'historial-item-fecha', `${fecha(c.actualizada)} · ${c.mensajes} mensajes`))
              b.addEventListener('click', () => void this.elegir(c.id))
              return b
            }))
      )
    }
    buscar.addEventListener('input', () => {
      this.filtro = buscar.value
      coinciden = new Set()
      pintarLista()
      // Además del título, busca dentro de los mensajes (índice de texto completo del proceso principal).
      const yo = ++pedido
      if (this.filtro.trim().length >= 2) {
        void window.orbe
          .historialBuscar(this.filtro)
          .then((ids) => {
            if (yo !== pedido) return
            coinciden = new Set(ids)
            pintarLista()
          })
          .catch(() => undefined)
      }
    })
    pintarLista()
    this.menu.replaceChildren(titulo, buscar, lista)
    buscar.focus()
  }

  private async elegir(id: string): Promise<void> {
    this.cerrar()
    try {
      const mensajes = await window.orbe.historialAbrir(id)
      if (mensajes) this.alAbrir(mensajes)
    } catch {
      // Si falla, el chat se queda como estaba.
    }
  }
}
