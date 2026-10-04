import type { EstadoMemoria, InformeImportacion, RecuerdoVista, ResultadoMemoria, TipoMemoria } from '../../shared/tipos'
import { crearIcono } from '../chat/contexto-ui'

const ETIQUETAS: Record<TipoMemoria, string> = {
  usuario: 'Perfil',
  preferencia: 'Preferencia',
  proyecto: 'Proyecto',
  nota: 'Nota'
}

const miles = new Intl.NumberFormat('es-ES')

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (clase) e.className = clase
  if (texto !== undefined) e.textContent = texto
  return e
}

function boton(clase: string, texto: string, alPulsar: () => void): HTMLButtonElement {
  const b = el('button', clase, texto)
  b.type = 'button'
  b.addEventListener('click', alPulsar)
  return b
}

/** Resumen en una frase de lo que hizo una importación desde la memoria de Claude. */
export function describirInforme(i: InformeImportacion): string {
  if (i.fuentes === 0) return 'No he encontrado ninguna memoria de Claude en este equipo.'
  const partes: string[] = []
  if (i.nuevas) partes.push(`${i.nuevas} ${i.nuevas === 1 ? 'nueva' : 'nuevas'}`)
  if (i.actualizadas) partes.push(`${i.actualizadas} ${i.actualizadas === 1 ? 'actualizada' : 'actualizadas'}`)
  if (i.sinCambios) partes.push(`${i.sinCambios} sin cambios`)
  const omitidas = i.omitidas.length > 0 ? ` Omitidas: ${i.omitidas.map((o) => `${o.nombre} (${o.motivo})`).join('; ')}.` : ''
  return `${partes.join(', ') || 'Nada nuevo'}.${omitidas}`
}

interface AvisoError {
  texto: string
  /** Si es un dato delicado, permite guardarlo igualmente. */
  insistir?: () => void
}

/**
 * El gestor de memoria: qué sabe Orbe del usuario, con control total. Se pueden activar y desactivar los
 * recuerdos, editarlos, borrarlos, añadir otros, volver a importar la memoria de Claude y ver cuánto espacio
 * ocupan en cada conversación.
 */
export class VistaMemoria {
  private estado: EstadoMemoria | null = null
  private abierto: string | null = null
  private informe: string | null = null
  private error: AvisoError | null = null
  private borrador = ''
  private confirmandoVaciar = false
  private temporizadorVaciar = 0

  constructor(
    private readonly raiz: HTMLElement,
    private readonly alVolver: () => void
  ) {}

  get visible(): boolean {
    return !this.raiz.hidden
  }

  async abrir(): Promise<void> {
    this.raiz.hidden = false
    this.error = null
    this.informe = null
    try {
      this.estado = await window.orbe.memoriaEstado()
      this.pintar()
    } catch {
      this.raiz.replaceChildren(el('p', 'memoria-nota', 'No he podido leer la memoria.'))
    }
  }

  cerrar(): void {
    this.raiz.hidden = true
    this.abierto = null
    this.confirmandoVaciar = false
    window.clearTimeout(this.temporizadorVaciar)
  }

  // -------------------------------------------------------------------------------------------
  // Acciones
  // -------------------------------------------------------------------------------------------

  private aplicar(r: ResultadoMemoria, alInsistir?: () => void): boolean {
    if (r.ok) {
      this.estado = r.estado
      this.error = null
    } else {
      this.error = { texto: r.error, ...(r.sensible && alInsistir ? { insistir: alInsistir } : {}) }
    }
    this.pintar()
    return r.ok
  }

  private async activar(activa: boolean): Promise<void> {
    this.aplicar(await window.orbe.memoriaActivar(activa))
  }

  private async guardarNota(texto: string, forzar: boolean): Promise<void> {
    const r = await window.orbe.memoriaGuardar(texto, forzar)
    if (r.ok) this.borrador = ''
    this.aplicar(r, () => void this.guardarNota(texto, true))
  }

  private async actualizar(id: string, cambios: Parameters<typeof window.orbe.memoriaActualizar>[1], forzar = false): Promise<void> {
    this.aplicar(await window.orbe.memoriaActualizar(id, cambios, forzar), () => void this.actualizar(id, cambios, true))
  }

  private async borrar(id: string): Promise<void> {
    if (this.aplicar(await window.orbe.memoriaBorrar(id)) && this.abierto === id) {
      this.abierto = null
      this.pintar()
    }
  }

  private async importar(): Promise<void> {
    this.informe = 'Importando…'
    this.pintar()
    try {
      const { informe, estado } = await window.orbe.memoriaImportar()
      this.estado = estado
      this.informe = describirInforme(informe)
    } catch {
      this.informe = 'No se pudo importar.'
    }
    this.pintar()
  }

  private pedirVaciar(): void {
    if (!this.confirmandoVaciar) {
      this.confirmandoVaciar = true
      this.temporizadorVaciar = window.setTimeout(() => {
        this.confirmandoVaciar = false
        this.pintar()
      }, 4000)
      this.pintar()
      return
    }
    window.clearTimeout(this.temporizadorVaciar)
    this.confirmandoVaciar = false
    this.abierto = null
    void window.orbe.memoriaVaciar().then((r) => this.aplicar(r))
  }

  // -------------------------------------------------------------------------------------------
  // Pintado
  // -------------------------------------------------------------------------------------------

  private pintar(): void {
    const e = this.estado
    if (!e) return
    const desplazamiento = this.raiz.querySelector('.memoria-cuerpo')?.scrollTop ?? 0

    // Cabecera: volver, título e interruptor general.
    const cabecera = el('div', 'memoria-cabecera')
    const volver = el('button', 'boton-icono')
    volver.type = 'button'
    volver.title = 'Volver al chat'
    volver.setAttribute('aria-label', 'Volver al chat')
    volver.append(crearIcono('volver', 18))
    volver.addEventListener('click', () => this.alVolver())
    const interruptor = el('label', 'interruptor')
    const caja = el('input', 'interruptor-caja')
    caja.type = 'checkbox'
    caja.checked = e.activa
    caja.id = 'memoria-activa'
    caja.addEventListener('change', () => void this.activar(caja.checked))
    interruptor.append(caja, el('span', 'interruptor-pista'), el('span', 'interruptor-texto', e.activa ? 'Activa' : 'Apagada'))
    cabecera.append(volver, el('span', 'memoria-titulo', 'Memoria'), interruptor)

    const cuerpo = el('div', 'memoria-cuerpo')
    cuerpo.classList.toggle('apagada', !e.activa)

    // Resumen y medidor de espacio.
    const total = e.recuerdos.length
    const { usados, max, omitidos } = e.presupuesto
    const resumen =
      total === 0
        ? 'Todavía no hay nada guardado. Escribe «Recuerda que…» en el chat o añádelo aquí.'
        : !e.activa
          ? `Memoria apagada: Orbe no usa nada de esto ni guarda la conversación. Tus ${total} ${total === 1 ? 'recuerdo sigue guardado' : 'recuerdos siguen guardados'}.`
          : `${total} ${total === 1 ? 'recuerdo' : 'recuerdos'} · ${miles.format(usados)} de ${miles.format(max)} caracteres viajan en cada conversación` +
            (omitidos > 0 ? ` (${omitidos} no ${omitidos === 1 ? 'cabe' : 'caben'})` : '')
    const medidor = el('div', 'medidor')
    medidor.setAttribute('role', 'meter')
    medidor.setAttribute('aria-valuemin', '0')
    medidor.setAttribute('aria-valuemax', String(max))
    medidor.setAttribute('aria-valuenow', String(usados))
    const relleno = el('div', `medidor-relleno${omitidos > 0 ? ' lleno' : ''}`)
    relleno.style.width = `${Math.min(100, Math.round((usados / Math.max(1, max)) * 100))}%`
    medidor.append(relleno)
    cuerpo.append(el('p', 'memoria-resumen', resumen), medidor)

    // Añadir una nota.
    const formulario = el('form', 'memoria-nueva')
    const texto = el('textarea', 'memoria-texto')
    texto.rows = 2
    texto.placeholder = 'Escribe algo que Orbe deba recordar…'
    texto.setAttribute('aria-label', 'Nuevo recuerdo')
    texto.value = this.borrador
    texto.addEventListener('input', () => (this.borrador = texto.value))
    texto.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault()
        formulario.requestSubmit()
      }
    })
    const guardar = el('button', 'boton-memoria primario', 'Guardar')
    guardar.type = 'submit'
    formulario.append(texto, guardar)
    formulario.addEventListener('submit', (ev) => {
      ev.preventDefault()
      if (texto.value.trim()) void this.guardarNota(texto.value, false)
    })
    cuerpo.append(formulario)

    if (this.error) {
      const aviso = el('div', 'memoria-error')
      aviso.setAttribute('role', 'alert')
      aviso.append(el('p', undefined, this.error.texto))
      if (this.error.insistir) aviso.append(boton('boton-memoria', 'Guardar de todos modos', this.error.insistir))
      cuerpo.append(aviso)
    }

    // Lista de recuerdos.
    const lista = el('ul', 'memoria-lista')
    for (const r of e.recuerdos) lista.append(this.crearFila(r))
    cuerpo.append(lista)

    // Acciones generales.
    const acciones = el('div', 'memoria-acciones')
    acciones.append(
      boton('boton-memoria', 'Importar de Claude', () => void this.importar()),
      boton('boton-memoria', 'Abrir carpeta', () => window.orbe.memoriaCarpeta()),
      boton(`boton-memoria peligro${this.confirmandoVaciar ? ' confirmar' : ''}`, this.confirmandoVaciar ? '¿Seguro? Pulsa otra vez' : 'Borrar todo', () =>
        this.pedirVaciar()
      )
    )
    cuerpo.append(acciones)
    if (this.informe) cuerpo.append(el('p', 'memoria-informe', this.informe))
    cuerpo.append(
      el(
        'p',
        'memoria-nota',
        'Los recuerdos activos se envían a Claude al empezar cada conversación y se guardan, en claro, en tu equipo. ' +
          'La conversación en curso también se guarda para poder seguirla al volver; «Nueva conversación» la borra.'
      )
    )

    this.raiz.replaceChildren(cabecera, cuerpo)
    cuerpo.scrollTop = desplazamiento
  }

  private crearFila(r: RecuerdoVista): HTMLElement {
    const abierto = this.abierto === r.id
    const li = el('li', `recuerdo${r.usar ? '' : ' desactivado'}${abierto ? ' abierto' : ''}`)

    const fila = el('div', 'recuerdo-fila')
    const usar = el('input', 'recuerdo-usar')
    usar.type = 'checkbox'
    usar.checked = r.usar
    usar.title = r.usar ? 'Se usa: pulsa para dejar de usarlo' : 'No se usa: pulsa para usarlo'
    usar.setAttribute('aria-label', `Usar «${r.titulo}»`)
    usar.addEventListener('change', () => void this.actualizar(r.id, { usar: usar.checked }))

    const titulo = el('button', 'recuerdo-titulo')
    titulo.type = 'button'
    titulo.setAttribute('aria-expanded', String(abierto))
    titulo.append(el('span', `etiqueta-tipo tipo-${r.tipo}`, ETIQUETAS[r.tipo]), el('span', 'recuerdo-texto', r.titulo))
    titulo.addEventListener('click', () => {
      this.abierto = abierto ? null : r.id
      this.pintar()
    })

    const peso = el('span', 'recuerdo-peso', !r.usar ? '—' : r.caracteres > 0 ? miles.format(r.caracteres) : 'no cabe')
    peso.title = 'Caracteres que ocupa en cada conversación'
    fila.append(usar, titulo, peso)
    li.append(fila)

    if (abierto) li.append(this.crearDetalle(r))
    return li
  }

  private crearDetalle(r: RecuerdoVista): HTMLElement {
    const detalle = el('div', 'recuerdo-detalle')

    const campoTitulo = el('input', 'memoria-campo')
    campoTitulo.type = 'text'
    campoTitulo.value = r.titulo
    campoTitulo.maxLength = 300
    campoTitulo.setAttribute('aria-label', 'Resumen')
    const campoCuerpo = el('textarea', 'memoria-campo memoria-campo-texto')
    campoCuerpo.rows = 5
    campoCuerpo.value = r.cuerpo
    campoCuerpo.setAttribute('aria-label', 'Texto completo')

    const completo = el('label', 'memoria-opcion')
    const casilla = el('input')
    casilla.type = 'checkbox'
    casilla.checked = r.completo
    completo.append(casilla, el('span', undefined, 'Enviar el texto completo (si no, solo el resumen)'))

    const origen = el(
      'p',
      'recuerdo-origen',
      r.origen === 'claude' ? 'Importado de la memoria de Claude. Si lo borras, no se vuelve a importar.' : 'Lo creaste tú.'
    )
    const acciones = el('div', 'recuerdo-acciones')
    acciones.append(
      boton('boton-memoria primario', 'Guardar cambios', () =>
        void this.actualizar(r.id, { titulo: campoTitulo.value, cuerpo: campoCuerpo.value, completo: casilla.checked })
      ),
      boton('boton-memoria peligro', 'Borrar', () => void this.borrar(r.id))
    )
    detalle.append(campoTitulo, campoCuerpo, completo, origen, acciones)
    return detalle
  }
}
