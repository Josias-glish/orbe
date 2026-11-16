import { borradorProfundizar, type AccionBocadillo, type ComentarioCompanero } from '../shared/companero'

const DURACION_MS = 25_000
const DURACION_PELICULA_MS = 14_000

/**
 * El bocadillo del Compañero: [Profundizar] deja un borrador en el chat (lo envías tú), [Esto no] silencia ese tipo de
 * comentario en esa app y [✕] lo cierra. Si no lo tocas, se va solo y cuenta como ignorado.
 */
export class Bocadillo {
  private actual: ComentarioCompanero | null = null
  private temporizador = 0

  constructor(
    private readonly el: HTMLElement,
    private readonly ponerBorrador: (texto: string) => void
  ) {
    el.addEventListener('mouseenter', () => window.clearTimeout(this.temporizador))
    el.addEventListener('mouseleave', () => this.programar())
  }

  get abierto(): boolean {
    return this.actual !== null
  }

  mostrar(c: ComentarioCompanero): void {
    this.actual = c
    const texto = document.createElement('p')
    texto.className = 'bocadillo-texto'
    texto.textContent = c.texto
    const acciones = document.createElement('div')
    acciones.className = 'bocadillo-acciones'
    const boton = (etiqueta: string, titulo: string, accion: AccionBocadillo): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = etiqueta
      b.title = titulo
      b.addEventListener('click', () => this.cerrar(accion))
      return b
    }
    acciones.append(
      boton('Profundizar', 'Abrir el chat con este tema (lo envías tú)', 'profundizar'),
      boton('Esto no', `No comentar más esto en ${c.app}`, 'esto_no'),
      boton('✕', 'Cerrar', 'cerrar')
    )
    this.el.replaceChildren(texto, acciones)
    this.el.classList.toggle('pelicula', c.pelicula)
    this.el.hidden = false
    this.programar()
  }

  private programar(): void {
    window.clearTimeout(this.temporizador)
    if (this.actual) this.temporizador = window.setTimeout(() => this.cerrar('ignorado'), this.actual.pelicula ? DURACION_PELICULA_MS : DURACION_MS)
  }

  cerrar(accion: AccionBocadillo): void {
    const c = this.actual
    if (!c) return
    this.actual = null
    window.clearTimeout(this.temporizador)
    this.el.hidden = true
    this.el.replaceChildren()
    if (accion === 'profundizar') this.ponerBorrador(borradorProfundizar(c))
    window.orbe.companeroResponder(c.id, accion)
  }
}
