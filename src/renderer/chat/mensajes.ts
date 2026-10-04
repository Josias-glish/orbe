import type { AvisoMemoria, ErrorOrbe, MotivoFin, ParteContexto } from '../../shared/tipos'
import { crearChipsAdjuntos, crearIcono } from './contexto-ui'
import { renderizarMarkdown } from './markdown'

/** Distancia al final (px) a la que se considera que la persona sigue «pegada» al último mensaje. */
const MARGEN_PEGADO = 48

function elemento<K extends keyof HTMLElementTagNameMap>(
  etiqueta: K,
  clase?: string,
  texto?: string
): HTMLElementTagNameMap[K] {
  const el = document.createElement(etiqueta)
  if (clase) el.className = clase
  if (texto !== undefined) el.textContent = texto
  return el
}

/** Respuesta del asistente mientras llega en streaming. */
export class RespuestaEnCurso {
  readonly el: HTMLElement
  private readonly contenido: HTMLElement
  private readonly indicador: HTMLElement
  private texto = ''
  private pendiente = 0

  constructor(private readonly lista: ListaMensajes) {
    this.el = elemento('div', 'msg asistente')
    this.contenido = elemento('div', 'contenido')
    this.indicador = elemento('div', 'escribiendo')
    this.indicador.setAttribute('aria-label', 'Claude está pensando')
    for (let i = 0; i < 3; i++) this.indicador.append(elemento('span'))
    this.el.append(this.indicador, this.contenido)
  }

  get textoActual(): string {
    return this.texto
  }

  anexar(delta: string): void {
    if (!this.texto) this.indicador.remove()
    this.texto += delta
    // Se pinta como mucho una vez por fotograma, aunque lleguen decenas de fragmentos.
    if (!this.pendiente) {
      this.pendiente = requestAnimationFrame(() => {
        this.pendiente = 0
        this.pintar()
      })
    }
  }

  private pintar(): void {
    const pegado = this.lista.estaPegado()
    // Seguro: renderizarMarkdown devuelve HTML saneado con DOMPurify (sin scripts, estilos ni imágenes).
    this.contenido.innerHTML = renderizarMarkdown(this.texto)
    if (pegado) this.lista.desplazarAlFinal()
  }

  /** Cierra la respuesta: pinta el texto final y añade las notas y el botón de copiar. */
  finalizar(motivo: MotivoFin): void {
    if (this.pendiente) cancelAnimationFrame(this.pendiente)
    this.pendiente = 0
    this.indicador.remove()

    if (!this.texto) {
      // Se detuvo antes de que llegara nada: no deja burbuja vacía.
      this.el.remove()
      return
    }
    this.pintar()
    if (motivo === 'cancelado') this.el.append(elemento('p', 'nota', 'Respuesta detenida'))
    if (motivo === 'limite_tokens') this.el.append(elemento('p', 'nota', 'La respuesta se cortó por su longitud máxima'))
    this.el.append(this.crearBotonCopiar())
  }

  /** Quita la respuesta (p. ej. si falló antes de producir nada). */
  descartarSiVacia(): void {
    if (this.pendiente) cancelAnimationFrame(this.pendiente)
    this.pendiente = 0
    this.indicador.remove()
    if (!this.texto) this.el.remove()
    else {
      this.pintar()
    }
  }

  private crearBotonCopiar(): HTMLButtonElement {
    const boton = elemento('button', 'boton-copiar', 'Copiar')
    boton.type = 'button'
    boton.addEventListener('click', () => {
      navigator.clipboard
        .writeText(this.texto)
        .then(() => {
          boton.textContent = 'Copiado'
          window.setTimeout(() => (boton.textContent = 'Copiar'), 1400)
        })
        .catch(() => {
          boton.textContent = 'No se pudo copiar'
        })
    })
    return boton
  }
}

/** Lista de mensajes del panel: usuario, asistente, errores y avisos. */
export class ListaMensajes {
  private pegado = true

  constructor(
    private readonly contenedor: HTMLElement,
    private readonly vacio: HTMLElement
  ) {
    contenedor.addEventListener('scroll', () => {
      this.pegado = contenedor.scrollHeight - contenedor.scrollTop - contenedor.clientHeight < MARGEN_PEGADO
    })
  }

  estaPegado(): boolean {
    return this.pegado
  }

  hayMensajes(): boolean {
    return this.contenedor.querySelector('.msg, .tarjeta-error') !== null
  }

  desplazarAlFinal(): void {
    this.contenedor.scrollTop = this.contenedor.scrollHeight
    this.pegado = true
  }

  private anadir(el: HTMLElement): void {
    this.vacio.hidden = true
    this.contenedor.append(el)
    this.desplazarAlFinal()
  }

  agregarUsuario(texto: string): HTMLElement {
    const el = elemento('div', 'msg usuario')
    el.append(elemento('div', 'contenido-plano', texto))
    this.anadir(el)
    return el
  }

  /** Muestra bajo el mensaje qué contexto de pantalla viajó con él. */
  adjuntarChips(burbuja: HTMLElement, partes: ParteContexto[]): void {
    if (partes.length === 0) return
    const pegado = this.pegado
    burbuja.append(crearChipsAdjuntos(partes))
    if (pegado) this.desplazarAlFinal()
  }

  /**
   * Cuelga del mensaje del usuario lo que pasó con una orden de «recuerda que…»: si se guardó (con un botón
   * para deshacerlo) o por qué no. `alDeshacer` borra el recuerdo y dice si lo consiguió.
   */
  adjuntarAvisoMemoria(burbuja: HTMLElement, aviso: AvisoMemoria, alDeshacer: (id: string) => Promise<boolean>): void {
    const pegado = this.pegado
    const nota = elemento('div', `nota-memoria ${aviso.tipo === 'guardado' ? 'guardada' : 'no-guardada'}`)
    nota.setAttribute('role', 'status')
    if (aviso.tipo === 'guardado') {
      const texto = elemento('span', 'nota-memoria-texto', 'Guardado en la memoria')
      nota.append(crearIcono('marca', 13), texto)
      const deshacer = elemento('button', 'nota-memoria-deshacer', 'Deshacer')
      deshacer.type = 'button'
      deshacer.addEventListener('click', () => {
        deshacer.disabled = true
        void alDeshacer(aviso.id).then((ok) => {
          if (ok) {
            nota.classList.replace('guardada', 'deshecha')
            texto.textContent = 'Recuerdo borrado'
            deshacer.remove()
          } else {
            deshacer.disabled = false
            texto.textContent = 'No se pudo borrar'
          }
        })
      })
      nota.append(deshacer)
    } else {
      nota.append(elemento('span', 'nota-memoria-texto', `No se guardó: ${aviso.motivo}`))
    }
    burbuja.append(nota)
    if (pegado) this.desplazarAlFinal()
  }

  iniciarRespuesta(): RespuestaEnCurso {
    const respuesta = new RespuestaEnCurso(this)
    this.anadir(respuesta.el)
    return respuesta
  }

  /** Pinta una respuesta ya terminada (al restaurar la conversación guardada). */
  agregarRespuestaGuardada(texto: string): void {
    const respuesta = this.iniciarRespuesta()
    respuesta.anexar(texto)
    respuesta.finalizar('completo')
  }

  agregarAviso(texto: string): void {
    this.anadir(elemento('p', 'aviso', texto))
  }

  /** Un aviso al abrir Orbe que no esconde la pantalla de bienvenida (todavía no hay mensajes). */
  agregarAvisoInicial(texto: string): void {
    this.contenedor.append(elemento('p', 'aviso', texto))
  }

  /** Tarjeta de error con detalles técnicos plegados y, si tiene sentido, un botón para reintentar. */
  agregarError(error: ErrorOrbe, alReintentar?: () => void): HTMLElement {
    const tarjeta = elemento('div', 'tarjeta-error')
    tarjeta.setAttribute('role', 'alert')
    tarjeta.append(elemento('p', 'error-titulo', error.titulo), elemento('p', 'error-mensaje', error.mensaje))

    if (error.detalle) {
      const detalles = elemento('details', 'error-detalle')
      detalles.append(elemento('summary', undefined, 'Detalles técnicos'), elemento('code', undefined, error.detalle))
      tarjeta.append(detalles)
    }
    if (error.reintentable && alReintentar) {
      const boton = elemento('button', 'boton-secundario', 'Reintentar')
      boton.type = 'button'
      boton.addEventListener('click', () => {
        tarjeta.remove()
        alReintentar()
      })
      tarjeta.append(boton)
    }
    this.anadir(tarjeta)
    return tarjeta
  }

  limpiar(): void {
    this.contenedor.querySelectorAll('.msg, .tarjeta-error, .aviso').forEach((el) => el.remove())
    this.vacio.hidden = false
    this.pegado = true
  }
}
