import type { ConfirmacionVista } from '../../shared/tipos'
import type { ConfirmacionCaptura } from './captura-ui'
import { crearIcono } from './contexto-ui'

const ETIQUETA_POR_DEFECTO = 'Confirmar una acción del agente'

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (clase) e.className = clase
  if (texto !== undefined) e.textContent = texto
  return e
}

/**
 * La tarjeta con la que el agente pide permiso: dice la acción exacta y ofrece Permitir y Cancelar. Comparte caja y
 * estilo con la confirmación de la captura. A propósito no roba el foco (el usuario puede estar escribiendo y un
 * Enter no debe permitir nada por accidente); Esc la cancela.
 */
export class ConfirmacionAccion {
  private resolver: ((permitir: boolean) => void) | null = null
  private readonly etiquetaOriginal: string

  constructor(
    private readonly caja: HTMLElement,
    private readonly captura: ConfirmacionCaptura
  ) {
    this.etiquetaOriginal = caja.getAttribute('aria-label') ?? ''
  }

  get visible(): boolean {
    return this.resolver !== null
  }

  /** Muestra la tarjeta y resuelve `true` si el usuario pulsa «Permitir» y `false` si cancela. */
  pedir(c: ConfirmacionVista): Promise<boolean> {
    this.cancelar()
    this.captura.cancelar()
    return new Promise<boolean>((resolver) => {
      this.resolver = resolver

      const permitir = el('button', 'confirmacion-permitir', c.etiquetaPermitir ?? 'Permitir')
      permitir.type = 'button'
      permitir.addEventListener('click', () => this.cerrar(true))
      const cancelar = el('button', 'confirmacion-cancelar', c.etiquetaCancelar ?? 'Cancelar')
      cancelar.type = 'button'
      cancelar.addEventListener('click', () => this.cerrar(false))

      const titulo = el('p', 'confirmacion-titulo')
      titulo.append(crearIcono('escudo', 15), document.createTextNode(` ${c.titulo}`))
      const botones = el('div', 'confirmacion-botones')
      botones.append(permitir, cancelar)

      this.caja.classList.toggle('peligrosa', c.peligrosa === true)
      this.caja.setAttribute('aria-label', ETIQUETA_POR_DEFECTO)
      this.caja.replaceChildren(titulo, el('p', 'confirmacion-texto', c.detalle), botones)
      this.caja.hidden = false
    })
  }

  /** Cierra la tarjeta como si el usuario hubiera cancelado (con Esc, al detener la tarea o al terminar el turno). */
  cancelar(): void {
    if (this.resolver) this.cerrar(false)
  }

  private cerrar(permite: boolean): void {
    const resolver = this.resolver
    this.resolver = null
    this.caja.hidden = true
    this.caja.classList.remove('peligrosa')
    this.caja.setAttribute('aria-label', this.etiquetaOriginal)
    this.caja.replaceChildren()
    resolver?.(permite)
  }
}
