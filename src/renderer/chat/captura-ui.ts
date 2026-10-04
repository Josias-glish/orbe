import { crearIcono } from './contexto-ui'

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (clase) e.className = clase
  if (texto !== undefined) e.textContent = texto
  return e
}

/**
 * La tarjeta que pide permiso antes de hacer una captura de pantalla. Dice qué va a pasar (se oculta Orbe un
 * instante y se fotografía el monitor) y que la imagen se verá antes de enviarla. Sin un «Capturar» explícito,
 * no se captura nada.
 */
export class ConfirmacionCaptura {
  private resolver: ((acepta: boolean) => void) | null = null

  constructor(private readonly caja: HTMLElement) {}

  get visible(): boolean {
    return this.resolver !== null
  }

  /** Muestra la tarjeta y resuelve `true` si el usuario pulsa «Capturar», `false` si cancela. */
  pedir(): Promise<boolean> {
    this.cancelar()
    return new Promise<boolean>((resolver) => {
      this.resolver = resolver

      const capturar = el('button', 'confirmacion-capturar', 'Capturar')
      capturar.type = 'button'
      capturar.addEventListener('click', () => this.cerrar(true))
      const cancelar = el('button', 'confirmacion-cancelar', 'Cancelar')
      cancelar.type = 'button'
      cancelar.addEventListener('click', () => this.cerrar(false))

      const titulo = el('p', 'confirmacion-titulo')
      titulo.append(crearIcono('camara', 15), document.createTextNode(' ¿Hacer una captura de pantalla?'))
      const botones = el('div', 'confirmacion-botones')
      botones.append(capturar, cancelar)
      this.caja.replaceChildren(
        titulo,
        el(
          'p',
          'confirmacion-texto',
          'Ocultaré Orbe un instante y fotografiaré el monitor donde está la ventana que estabas usando. ' +
            'Verás la captura aquí antes de enviarla y solo viaja a Claude si envías el mensaje.'
        ),
        botones
      )
      this.caja.hidden = false
      capturar.focus()
    })
  }

  /** Cierra la tarjeta como si el usuario hubiera cancelado (por ejemplo, con Esc). */
  cancelar(): void {
    if (this.resolver) this.cerrar(false)
  }

  private cerrar(acepta: boolean): void {
    const resolver = this.resolver
    this.resolver = null
    this.caja.hidden = true
    this.caja.replaceChildren()
    resolver?.(acepta)
  }
}

/** Una línea discreta sobre el campo de texto que propone adjuntar una captura (poco texto en la ventana, o pregunta visual). */
export class SugerenciaCaptura {
  constructor(
    private readonly caja: HTMLElement,
    private readonly alAceptar: () => void,
    private readonly alCerrar: () => void
  ) {}

  get visible(): boolean {
    return !this.caja.hidden
  }

  mostrar(texto: string): void {
    // Si ya se muestra lo mismo, no se vuelve a pintar (escribir no debe hacerla parpadear).
    if (!this.caja.hidden && this.caja.dataset['texto'] === texto) return
    this.caja.dataset['texto'] = texto

    const accion = el('button', 'sugerencia-accion', 'Hacer captura')
    accion.type = 'button'
    accion.addEventListener('click', () => this.alAceptar())
    const cerrar = el('button', 'sugerencia-cerrar')
    cerrar.type = 'button'
    cerrar.title = 'No volver a sugerirlo en este mensaje'
    cerrar.setAttribute('aria-label', 'Cerrar la sugerencia')
    cerrar.append(crearIcono('cerrar', 12))
    cerrar.addEventListener('click', () => this.alCerrar())

    this.caja.replaceChildren(crearIcono('camara', 14), el('span', 'sugerencia-texto', texto), accion, cerrar)
    this.caja.hidden = false
  }

  ocultar(): void {
    if (this.caja.hidden) return
    this.caja.hidden = true
    delete this.caja.dataset['texto']
    this.caja.replaceChildren()
  }
}
