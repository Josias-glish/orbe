import { describirPrograma } from '../../shared/tareas'
import type { EjecucionTarea, EstadoTareas, ProgramaTarea, TareaNueva, TareaVista } from '../../shared/tipos'
import { crearIcono } from '../chat/contexto-ui'

type Pestana = 'curso' | 'programadas' | 'completadas'

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

/** «hoy 08:30», «mañana 09:00», «lun 12/11 18:00». */
export function cuandoCorto(ms: number, ahora = Date.now()): string {
  const d = new Date(ms)
  const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  const dia = (x: Date): string => x.toDateString()
  const hoy = new Date(ahora)
  const manana = new Date(ahora + 86_400_000)
  const ayer = new Date(ahora - 86_400_000)
  if (dia(d) === dia(hoy)) return `hoy ${hora}`
  if (dia(d) === dia(manana)) return `mañana ${hora}`
  if (dia(d) === dia(ayer)) return `ayer ${hora}`
  return `${d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'numeric' })} ${hora}`
}

const ETIQUETA_ESTADO: Record<EjecucionTarea['estado'], string> = {
  'en-curso': 'Trabajando',
  esperando: 'Te necesita',
  completada: 'Hecha',
  'nada-nuevo': 'Nada nuevo',
  error: 'Error',
  cancelada: 'Detenida'
}

/** Ideas para empezar, como las plantillas de los agentes «siempre encendidos». */
export const PLANTILLAS: ReadonlyArray<{ titulo: string; instruccion: string; programa: ProgramaTarea; soloSiHayAlgo?: boolean }> = [
  {
    titulo: 'Noticias de IA de la mañana',
    instruccion: 'Busca las 5 noticias más importantes de inteligencia artificial de las últimas 24 horas y resúmelas en una línea cada una, con su enlace.',
    programa: { tipo: 'diaria', hora: '08:30' }
  },
  {
    titulo: 'Vigilar un precio',
    instruccion: 'Mira el precio actual de [producto] en [tienda]. Avísame solo si ha bajado de [precio].',
    programa: { tipo: 'cada', minutos: 240 },
    soloSiHayAlgo: true
  },
  {
    titulo: 'Plan de la semana',
    instruccion: 'Prepárame un plan de la semana con 3 prioridades a partir de lo que sabes de mis proyectos, y una pregunta para enfocarme.',
    programa: { tipo: 'semanal', dias: [1], hora: '09:00' }
  }
]

/**
 * Las tareas de fondo: lo que Orbe está haciendo ahora, lo que tiene programado y lo que ya terminó, como el perfil
 * de un agente «siempre encendido». Desde aquí se crean (ahora, una vez, cada día, ciertos días o cada cierto
 * tiempo), se dan o niegan los permisos que piden, se detienen y se leen sus resultados.
 */
export class VistaTareas {
  private estado: EstadoTareas | null = null
  private pestana: Pestana = 'programadas'
  private editando: TareaNueva | null = null
  private error: string | null = null

  constructor(
    private readonly raiz: HTMLElement,
    private readonly alVolver: () => void,
    private readonly alPendientes?: (n: number) => void
  ) {
    window.orbe.alTareas(() => void this.cargar())
    void this.cargar()
  }

  get visible(): boolean {
    return !this.raiz.hidden
  }

  async abrir(): Promise<void> {
    this.raiz.hidden = false
    this.error = null
    await this.cargar()
    if (this.estado && this.enCurso().length > 0) this.pestana = 'curso'
    this.pintar()
  }

  cerrar(): void {
    this.raiz.hidden = true
    this.editando = null
  }

  private async cargar(): Promise<void> {
    try {
      this.estado = await window.orbe.tareasEstado()
      this.alPendientes?.(this.estado.tareas.filter((t) => t.ultima?.estado === 'esperando').length)
      if (this.visible) this.pintar()
    } catch {
      // sin estado no se pinta nada nuevo
    }
  }

  private async hacer(accion: () => Promise<EstadoTareas>): Promise<void> {
    try {
      this.estado = await accion()
      this.error = null
    } catch (e) {
      this.error = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'No se pudo.'
    }
    this.pintar()
  }

  private enCurso(): TareaVista[] {
    return (this.estado?.tareas ?? []).filter((t) => t.ultima?.estado === 'en-curso' || t.ultima?.estado === 'esperando')
  }

  private programadas(): TareaVista[] {
    return (this.estado?.tareas ?? []).filter((t) => t.programa.tipo !== 'ahora' && (t.activa || t.programa.tipo !== 'una-vez'))
  }

  private completadas(): Array<{ tarea: TareaVista; e: EjecucionTarea }> {
    const r: Array<{ tarea: TareaVista; e: EjecucionTarea }> = []
    for (const tarea of this.estado?.tareas ?? []) for (const e of tarea.historial) if (e.fin !== null) r.push({ tarea, e })
    return r.sort((a, b) => (b.e.fin ?? 0) - (a.e.fin ?? 0)).slice(0, 60)
  }

  // ------------------------------------------------------------------ pintar

  private pintar(): void {
    if (!this.estado) return
    const cabecera = el('div', 'memoria-cabecera')
    const volver = el('button', 'boton-icono')
    volver.type = 'button'
    volver.title = 'Volver al chat'
    volver.setAttribute('aria-label', 'Volver al chat')
    volver.append(crearIcono('volver', 18))
    volver.addEventListener('click', () => (this.editando ? ((this.editando = null), this.pintar()) : this.alVolver()))
    cabecera.append(volver, el('span', 'memoria-titulo', this.editando ? (this.editando.id ? 'Editar tarea' : 'Nueva tarea') : 'Tareas'))
    if (!this.editando) cabecera.append(boton('boton-memoria', '+ Nueva', () => this.nueva()))

    const cuerpo = el('div', 'memoria-cuerpo tareas-cuerpo')
    if (this.error) cuerpo.append(el('p', 'memoria-error', this.error))
    if (!this.estado.disponible) cuerpo.append(el('p', 'memoria-nota', `Las tareas no pueden hacerse ahora: ${this.estado.motivo ?? 'falta configurar la IA.'}`))

    if (this.editando) {
      cuerpo.append(this.formulario(this.editando))
    } else {
      const curso = this.enCurso()
      const prog = this.programadas()
      const comp = this.completadas()
      const pestanas = el('div', 'tareas-pestanas')
      pestanas.setAttribute('role', 'tablist')
      const pestana = (id: Pestana, texto: string, n: number): void => {
        const b = boton(`tareas-pestana${this.pestana === id ? ' activa' : ''}`, n ? `${texto} · ${n}` : texto, () => {
          this.pestana = id
          this.pintar()
        })
        b.setAttribute('role', 'tab')
        b.setAttribute('aria-selected', String(this.pestana === id))
        pestanas.append(b)
      }
      pestana('curso', 'En curso', curso.length)
      pestana('programadas', 'Programadas', prog.length)
      pestana('completadas', 'Completadas', comp.length)
      cuerpo.append(pestanas)

      if (this.pestana === 'curso') {
        if (curso.length === 0) cuerpo.append(el('p', 'memoria-resumen', 'Nada en marcha ahora mismo. Pulsa «Hacer ahora» en una tarea o crea una nueva.'))
        for (const t of curso) cuerpo.append(this.tarjetaEnCurso(t))
      } else if (this.pestana === 'programadas') {
        if (prog.length === 0) cuerpo.append(this.vacio())
        for (const t of prog) cuerpo.append(this.tarjetaProgramada(t))
      } else {
        if (comp.length === 0) cuerpo.append(el('p', 'memoria-resumen', 'Aquí aparecerán los resultados de las tareas cuando terminen.'))
        for (const c of comp) cuerpo.append(this.tarjetaCompletada(c.tarea, c.e))
      }
    }
    this.raiz.replaceChildren(cabecera, cuerpo)
  }

  private vacio(): HTMLElement {
    const caja = el('div', 'tareas-vacio')
    caja.append(
      el('p', 'memoria-resumen', 'Dale a Orbe trabajo para hacer solo: un resumen cada mañana, vigilar algo o preparar tu semana. Te avisa cuando termina o si necesita tu permiso.'),
      el('p', 'uso-subtitulo', 'Ideas para empezar')
    )
    for (const p of PLANTILLAS) {
      const b = boton('tareas-plantilla', '', () => {
        this.editando = { titulo: p.titulo, instruccion: p.instruccion, programa: p.programa, soloSiHayAlgo: p.soloSiHayAlgo ?? false, activa: true }
        this.pintar()
      })
      b.append(el('strong', undefined, p.titulo), el('span', undefined, describirPrograma(p.programa)))
      caja.append(b)
    }
    return caja
  }

  private tarjetaEnCurso(t: TareaVista): HTMLElement {
    const e = t.ultima!
    const c = el('article', `tarea tarea-${e.estado}`)
    c.append(this.titulo(t, e.estado))
    c.append(el('p', 'tarea-paso', e.paso ? `Ahora: ${e.paso}` : `Empezó ${cuandoCorto(e.inicio)}`))
    if (e.permiso) {
      const permiso = el('div', `tarea-permiso${e.permiso.peligrosa ? ' peligrosa' : ''}`)
      permiso.append(el('strong', undefined, e.permiso.titulo), el('p', undefined, e.permiso.detalle))
      const acciones = el('div', 'tarea-acciones')
      acciones.append(
        boton('boton-memoria primario', 'Permitir', () => void this.hacer(() => window.orbe.tareasResponder(t.id, e.permiso!.confirmacionId, true))),
        boton('boton-memoria', 'No', () => void this.hacer(() => window.orbe.tareasResponder(t.id, e.permiso!.confirmacionId, false)))
      )
      permiso.append(acciones)
      c.append(permiso)
    }
    const acciones = el('div', 'tarea-acciones')
    acciones.append(boton('boton-memoria peligro', 'Detener', () => void this.hacer(() => window.orbe.tareasCancelar(t.id))))
    c.append(acciones)
    return c
  }

  private tarjetaProgramada(t: TareaVista): HTMLElement {
    const c = el('article', `tarea${t.activa ? '' : ' tarea-pausada'}`)
    c.append(this.titulo(t, t.activa ? null : 'pausada'))
    const linea = `${describirPrograma(t.programa)}${t.activa && t.proxima ? ` · próxima: ${cuandoCorto(t.proxima)}` : ''}${t.soloSiHayAlgo ? ' · avisa solo si hay algo' : ''}`
    c.append(el('p', 'tarea-paso', linea))
    if (t.ultima?.fin) c.append(el('p', 'memoria-nota', `Última: ${ETIQUETA_ESTADO[t.ultima.estado].toLowerCase()}, ${cuandoCorto(t.ultima.fin)}`))
    const acciones = el('div', 'tarea-acciones')
    acciones.append(
      boton('boton-memoria', 'Hacer ahora', () => void this.hacer(() => window.orbe.tareasEjecutar(t.id))),
      boton('boton-memoria', t.activa ? 'Pausar' : 'Reanudar', () => void this.hacer(() => window.orbe.tareasGuardar({ ...this.aNueva(t), activa: !t.activa }))),
      boton('boton-memoria', 'Editar', () => {
        this.editando = this.aNueva(t)
        this.pintar()
      }),
      boton('boton-memoria peligro', 'Borrar', () => void this.hacer(() => window.orbe.tareasBorrar(t.id)))
    )
    c.append(acciones)
    return c
  }

  private tarjetaCompletada(t: TareaVista, e: EjecucionTarea): HTMLElement {
    const c = el('details', `tarea tarea-${e.estado}`)
    const resumen = el('summary')
    resumen.append(this.titulo(t, e.estado), el('span', 'memoria-nota', cuandoCorto(e.fin ?? e.inicio)))
    const texto = el('div', 'tarea-resultado', e.resultado)
    const acciones = el('div', 'tarea-acciones')
    acciones.append(boton('boton-memoria', 'Repetir', () => void this.hacer(() => window.orbe.tareasEjecutar(t.id))))
    c.append(resumen, texto, acciones)
    return c
  }

  private titulo(t: TareaVista, estado: EjecucionTarea['estado'] | 'pausada' | null): HTMLElement {
    const fila = el('div', 'tarea-titulo')
    fila.append(el('strong', undefined, t.titulo))
    if (estado) fila.append(el('span', `tarea-insignia insignia-${estado}`, estado === 'pausada' ? 'En pausa' : ETIQUETA_ESTADO[estado]))
    return fila
  }

  private aNueva(t: TareaVista): TareaNueva {
    return { id: t.id, titulo: t.titulo, instruccion: t.instruccion, programa: t.programa, activa: t.activa, soloSiHayAlgo: t.soloSiHayAlgo }
  }

  private nueva(): void {
    this.editando = { titulo: '', instruccion: '', programa: { tipo: 'diaria', hora: '08:30' }, activa: true, soloSiHayAlgo: false }
    this.error = null
    this.pintar()
  }

  // ------------------------------------------------------------------ formulario

  private formulario(t: TareaNueva): HTMLElement {
    const form = el('form', 'tareas-form')
    const etiqueta = (texto: string, control: HTMLElement): HTMLLabelElement => {
      const l = el('label', 'tareas-campo')
      l.append(el('span', undefined, texto), control)
      return l
    }
    const instruccion = el('textarea', 'memoria-texto')
    instruccion.rows = 4
    instruccion.placeholder = 'Qué tiene que hacer Orbe. Ej.: «Busca vuelos Lima–Cusco para el próximo finde por menos de 120 $ y dime los 3 mejores».'
    instruccion.value = t.instruccion
    const titulo = el('input', 'memoria-campo')
    titulo.placeholder = 'Nombre corto (opcional)'
    titulo.value = t.titulo
    titulo.maxLength = 80

    const tipo = el('select', 'memoria-campo')
    for (const [v, texto] of [
      ['ahora', 'Ahora, una vez'],
      ['una-vez', 'Una vez, más tarde'],
      ['diaria', 'Cada día'],
      ['semanal', 'Algunos días de la semana'],
      ['cada', 'Cada cierto tiempo']
    ] as const) {
      const o = el('option', undefined, texto)
      o.value = v
      tipo.append(o)
    }
    tipo.value = t.programa.tipo

    const detalle = el('div', 'tareas-programa')
    const hora = el('input', 'memoria-campo')
    hora.type = 'time'
    hora.value = 'hora' in t.programa ? t.programa.hora : '08:30'
    const fecha = el('input', 'memoria-campo')
    fecha.type = 'datetime-local'
    const enUnaHora = new Date(t.programa.tipo === 'una-vez' ? t.programa.en : Date.now() + 3_600_000)
    fecha.value = new Date(enUnaHora.getTime() - enUnaHora.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    const minutos = el('select', 'memoria-campo')
    for (const [m, texto] of [
      [15, '15 minutos'],
      [30, '30 minutos'],
      [60, '1 hora'],
      [120, '2 horas'],
      [240, '4 horas'],
      [480, '8 horas'],
      [1440, '24 horas']
    ] as const) {
      const o = el('option', undefined, texto)
      o.value = String(m)
      minutos.append(o)
    }
    minutos.value = String(t.programa.tipo === 'cada' ? t.programa.minutos : 240)
    const dias = el('div', 'tareas-dias')
    const marcados = new Set(t.programa.tipo === 'semanal' ? t.programa.dias : [1, 2, 3, 4, 5])
    const cajas: HTMLInputElement[] = []
    for (const [d, n] of [
      [1, 'L'],
      [2, 'M'],
      [3, 'X'],
      [4, 'J'],
      [5, 'V'],
      [6, 'S'],
      [0, 'D']
    ] as const) {
      const l = el('label', 'tareas-dia')
      const c = el('input')
      c.type = 'checkbox'
      c.value = String(d)
      c.checked = marcados.has(d)
      cajas.push(c)
      l.append(c, el('span', undefined, n))
      dias.append(l)
    }
    const pintarDetalle = (): void => {
      detalle.replaceChildren()
      if (tipo.value === 'una-vez') detalle.append(etiqueta('Cuándo', fecha))
      if (tipo.value === 'diaria') detalle.append(etiqueta('A las', hora))
      if (tipo.value === 'semanal') detalle.append(dias, etiqueta('A las', hora))
      if (tipo.value === 'cada') detalle.append(etiqueta('Cada', minutos))
    }
    tipo.addEventListener('change', pintarDetalle)
    pintarDetalle()

    const solo = el('label', 'memoria-opcion')
    const cajaSolo = el('input')
    cajaSolo.type = 'checkbox'
    cajaSolo.checked = t.soloSiHayAlgo === true
    solo.append(cajaSolo, el('span', undefined, 'Avisarme solo si hay algo nuevo o importante'))

    const programa = (): ProgramaTarea => {
      switch (tipo.value) {
        case 'una-vez':
          return { tipo: 'una-vez', en: new Date(fecha.value).getTime() }
        case 'diaria':
          return { tipo: 'diaria', hora: hora.value }
        case 'semanal':
          return { tipo: 'semanal', hora: hora.value, dias: cajas.filter((c) => c.checked).map((c) => Number(c.value)) }
        case 'cada':
          return { tipo: 'cada', minutos: Number(minutos.value) }
        default:
          return { tipo: 'ahora' }
      }
    }

    const acciones = el('div', 'tarea-acciones')
    const guardar = el('button', 'boton-memoria primario', tipo.value === 'ahora' ? 'Hacer ahora' : 'Guardar')
    guardar.type = 'submit'
    tipo.addEventListener('change', () => (guardar.textContent = tipo.value === 'ahora' ? 'Hacer ahora' : 'Guardar'))
    acciones.append(
      guardar,
      boton('boton-memoria', 'Cancelar', () => {
        this.editando = null
        this.pintar()
      })
    )
    form.addEventListener('submit', (ev) => {
      ev.preventDefault()
      const nueva: TareaNueva = {
        ...(t.id ? { id: t.id } : {}),
        titulo: titulo.value,
        instruccion: instruccion.value,
        programa: programa(),
        activa: t.activa ?? true,
        soloSiHayAlgo: cajaSolo.checked
      }
      void (async () => {
        await this.hacer(() => window.orbe.tareasGuardar(nueva))
        if (!this.error) {
          this.editando = null
          this.pestana = nueva.programa.tipo === 'ahora' ? 'curso' : 'programadas'
          this.pintar()
        }
      })()
    })
    form.append(etiqueta('Instrucción', instruccion), etiqueta('Nombre', titulo), etiqueta('Cuándo', tipo), detalle, solo, acciones)
    form.append(
      el(
        'p',
        'memoria-nota',
        'Orbe la hace solo con la IA que tengas configurada, tu memoria y sus herramientas. Lo delicado (abrir apps, enviar o comprar) espera tu permiso aquí; si no respondes en 30 minutos, cuenta como «no».'
      )
    )
    queueMicrotask(() => instruccion.focus())
    return form
  }
}
