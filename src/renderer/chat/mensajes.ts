import type { AccionVista, AvisoMemoria, ErrorOrbe, EstadoAccion, MotivoFin, ParteContexto } from '../../shared/tipos'
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

/** Un tramo de texto de la respuesta: cada acción del agente cierra el que estaba en curso. */
interface Tramo {
  el: HTMLElement
  texto: string
}

/** El icono de cada estado de una acción (en curso lleva una animación en CSS en lugar de icono). */
const ICONO_ESTADO: Record<Exclude<EstadoAccion, 'en_curso'>, Parameters<typeof crearIcono>[0]> = {
  ok: 'marca',
  error: 'cerrar',
  denegada: 'escudo',
  cancelada: 'parar'
}

const TEXTO_ESTADO: Record<EstadoAccion, string> = {
  en_curso: 'en curso',
  ok: 'hecho',
  error: 'con error',
  denegada: 'no permitida',
  cancelada: 'detenida'
}

/** Respuesta del asistente mientras llega en streaming: tramos de texto con las acciones del agente entre medias. */
export class RespuestaEnCurso {
  readonly el: HTMLElement
  private readonly indicador: HTMLElement
  private readonly tramos: Tramo[] = []
  /** El tramo que sigue recibiendo texto; es null justo después de una acción. */
  private actual: Tramo | null = null
  private readonly acciones = new Map<string, HTMLElement>()
  private pendiente = 0

  constructor(private readonly lista: ListaMensajes) {
    this.el = elemento('div', 'msg asistente')
    this.indicador = elemento('div', 'escribiendo')
    this.indicador.setAttribute('aria-label', 'Claude está pensando')
    for (let i = 0; i < 3; i++) this.indicador.append(elemento('span'))
    this.el.append(this.indicador)
  }

  /** Todo el texto de la respuesta, tramo a tramo (sin las líneas de acción). */
  get textoActual(): string {
    return this.tramos
      .map((t) => t.texto)
      .filter(Boolean)
      .join('\n\n')
  }

  get hayAcciones(): boolean {
    return this.acciones.size > 0
  }

  anexar(delta: string): void {
    this.indicador.remove()
    if (!this.actual) {
      this.actual = { el: elemento('div', 'contenido'), texto: '' }
      this.tramos.push(this.actual)
      this.el.append(this.actual.el)
    }
    this.actual.texto += delta
    // Se pinta como mucho una vez por fotograma, aunque lleguen decenas de fragmentos.
    if (!this.pendiente) {
      this.pendiente = requestAnimationFrame(() => {
        this.pendiente = 0
        this.pintar()
      })
    }
  }

  private pintarTramo(tramo: Tramo): void {
    // Seguro: renderizarMarkdown devuelve HTML saneado con DOMPurify (sin scripts, estilos ni imágenes).
    tramo.el.innerHTML = renderizarMarkdown(tramo.texto)
  }

  private pintar(): void {
    if (!this.actual) return
    const pegado = this.lista.estaPegado()
    this.pintarTramo(this.actual)
    if (pegado) this.lista.desplazarAlFinal()
  }

  /** Cierra el tramo de texto en curso (pintándolo entero): lo que llegue después irá en otro tramo. */
  private cerrarTramo(): void {
    if (this.pendiente) cancelAnimationFrame(this.pendiente)
    this.pendiente = 0
    if (this.actual) this.pintarTramo(this.actual)
    this.actual = null
  }

  /** Muestra o actualiza la línea de una acción del agente (llega al empezar y al terminar, con el mismo id). */
  agregarAccion(accion: AccionVista): void {
    this.indicador.remove()
    const pegado = this.lista.estaPegado()
    let linea = this.acciones.get(accion.accionId)
    if (!linea) {
      this.cerrarTramo()
      linea = this.crearLinea()
      this.acciones.set(accion.accionId, linea)
      this.el.append(linea)
    }
    this.pintarLinea(linea, accion)
    if (pegado) this.lista.desplazarAlFinal()
  }

  private crearLinea(): HTMLElement {
    const linea = elemento('div', 'accion')
    const cabecera = elemento('button', 'accion-cabecera')
    cabecera.type = 'button'
    cabecera.setAttribute('aria-expanded', 'false')
    cabecera.append(elemento('span', 'accion-icono'), elemento('span', 'accion-titulo'))
    const detalle = elemento('div', 'accion-detalle')
    detalle.hidden = true
    cabecera.addEventListener('click', () => {
      const abierto = !detalle.hidden
      detalle.hidden = abierto
      cabecera.setAttribute('aria-expanded', String(!abierto))
    })
    linea.append(cabecera, detalle)
    return linea
  }

  /** Todo con `textContent`: el título y el resultado pueden traer texto de una página y nunca se interpretan como HTML. */
  private pintarLinea(linea: HTMLElement, accion: AccionVista): void {
    linea.dataset['estado'] = accion.estado
    const cabecera = linea.querySelector('.accion-cabecera') as HTMLElement
    const icono = linea.querySelector('.accion-icono') as HTMLElement
    icono.replaceChildren(...(accion.estado === 'en_curso' ? [] : [crearIcono(ICONO_ESTADO[accion.estado], 13)]))
    ;(linea.querySelector('.accion-titulo') as HTMLElement).textContent = accion.titulo
    cabecera.title = `${accion.herramienta} · ${TEXTO_ESTADO[accion.estado]}`
    const detalle = linea.querySelector('.accion-detalle') as HTMLElement
    const partes: HTMLElement[] = [elemento('p', 'accion-etiqueta', 'Parámetros'), elemento('pre', 'accion-texto', accion.parametros)]
    if (accion.resultado) {
      partes.push(elemento('p', 'accion-etiqueta', `Resultado (${TEXTO_ESTADO[accion.estado]})`), elemento('pre', 'accion-texto', accion.resultado))
    }
    detalle.replaceChildren(...partes)
  }

  /** Lo que quede «en curso» cuando el turno termina ya no puede estarlo: se marca como detenido. */
  private cerrarAccionesAbiertas(): void {
    for (const linea of this.acciones.values()) {
      if (linea.dataset['estado'] !== 'en_curso') continue
      linea.dataset['estado'] = 'cancelada'
      ;(linea.querySelector('.accion-icono') as HTMLElement).replaceChildren(crearIcono('parar', 13))
    }
  }

  /** Cierra la respuesta: pinta el texto final y añade las notas y el botón de copiar. */
  finalizar(motivo: MotivoFin): void {
    if (this.pendiente) cancelAnimationFrame(this.pendiente)
    this.pendiente = 0
    this.indicador.remove()

    const hayTexto = this.textoActual !== ''
    if (!hayTexto && !this.hayAcciones) {
      // Se detuvo antes de que llegara nada: no deja burbuja vacía.
      this.el.remove()
      return
    }
    for (const tramo of this.tramos) this.pintarTramo(tramo)
    this.cerrarAccionesAbiertas()
    if (motivo === 'cancelado') this.el.append(elemento('p', 'nota', this.hayAcciones ? 'Tarea detenida' : 'Respuesta detenida'))
    if (motivo === 'limite_tokens') this.el.append(elemento('p', 'nota', 'La respuesta se cortó por su longitud máxima'))
    if (motivo === 'limite_pasos') this.el.append(elemento('p', 'nota', 'La tarea llegó a su límite de pasos y se detuvo aquí'))
    if (hayTexto) this.el.append(this.crearBotonCopiar())
  }

  /** Quita la respuesta (p. ej. si falló antes de producir nada). */
  descartarSiVacia(): void {
    if (this.pendiente) cancelAnimationFrame(this.pendiente)
    this.pendiente = 0
    this.indicador.remove()
    if (this.textoActual === '' && !this.hayAcciones) this.el.remove()
    else {
      for (const tramo of this.tramos) this.pintarTramo(tramo)
      this.cerrarAccionesAbiertas()
    }
  }

  private crearBotonCopiar(): HTMLButtonElement {
    const boton = elemento('button', 'boton-copiar', 'Copiar')
    boton.type = 'button'
    boton.addEventListener('click', () => {
      navigator.clipboard
        .writeText(this.textoActual)
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
