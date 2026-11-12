import { esIdExpresion, type IdExpresion } from '../../shared/expresiones'
import type { AccionVista, EstadoActividad, EstadoTareas, EventoActividad, TipoActividad } from '../../shared/tipos'
import { registrarMenu } from '../chat/menus'
import type { Avatar } from './avatar'

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (clase) e.className = clase
  if (texto !== undefined) e.textContent = texto
  return e
}

/** La cara que pone el personaje con cada tipo de aviso, si el conector no pide otra. */
export const EXPRESION_DE_AVISO: Record<TipoActividad, IdExpresion> = {
  inicio: 'curioso',
  trabajando: 'concentrado',
  esperando: 'sorprendido',
  terminado: 'orgulloso',
  error: 'preocupado',
  info: 'feliz'
}
/** Cuánto dura la cara de cada aviso: lo que te necesita se queda más rato. */
const DURACION_AVISO: Record<TipoActividad, number> = { inicio: 2500, trabajando: 4000, esperando: 9000, terminado: 4500, error: 6000, info: 2500 }
/** Los avisos que cuentan en el globito del personaje (lo demás es ruido mientras trabaja). */
const IMPORTANTES: readonly TipoActividad[] = ['esperando', 'terminado', 'error']
const ETIQUETA_TIPO: Record<TipoActividad, string> = { inicio: 'Empezó', trabajando: 'Trabajando', esperando: 'Te necesita', terminado: 'Terminado', error: 'Error', info: 'Aviso' }

/**
 * El menú «Agentes» del carril: quién trabaja ahora y en qué, y los avisos de las herramientas conectadas (Claude Code
 * y otras). También pone la cara del personaje con cada aviso y pinta el globito con los avisos sin ver.
 */
export class MenuPersonaje {
  private readonly menus: { anunciarApertura(): void }
  private pestana: 'agentes' | 'actividad' = 'agentes'
  private readonly fijada: IdExpresion | null = null
  private tareas: EstadoTareas | null = null
  private readonly encargos = new Map<string, { quien: string; que: string; detalle: string; desde: number }>()
  private sinVer = 0
  private ultimos: EventoActividad[] = []
  private estado: EstadoActividad | null = null

  constructor(
    private readonly avatar: Avatar,
    private readonly boton: HTMLButtonElement,
    private readonly menu: HTMLElement,
    private readonly insignia: HTMLElement
  ) {
    this.menus = registrarMenu('personaje', () => this.cerrar())
    // Encargos del chat (herramienta «delegar»): el panel los anuncia con un evento.
    window.addEventListener('orbe:accion', (e) => this.alAccion((e as CustomEvent<AccionVista>).detail))
    window.orbe.alTareas(() => void this.refrescarTareas())
    boton.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.menu.hidden) this.abrir()
      else this.cerrar()
    })
    document.addEventListener('click', (e) => {
      if (!this.menu.hidden && !e.composedPath().includes(this.menu)) this.cerrar()
    })
    window.orbe.alActividad((evento) => this.alAviso(evento))
  }

  cerrarSiAbierto(): boolean {
    if (this.menu.hidden) return false
    this.cerrar()
    return true
  }

  /** Un aviso de un conector: el personaje pone su cara, y si es importante suma al globito. */
  alAviso(evento: EventoActividad): void {
    this.ultimos = [...this.ultimos, evento].slice(-50)
    const cara = esIdExpresion(evento.expresion) ? evento.expresion : EXPRESION_DE_AVISO[evento.tipo]
    if (!this.fijada) this.avatar.expresar(cara, DURACION_AVISO[evento.tipo])
    // Lo que te necesita te saluda para llamar tu atención; lo terminado se celebra; un error, niega con la cabeza.
    const gesto = evento.tipo === 'esperando' ? 'saludo' : evento.tipo === 'terminado' ? 'reverencia' : evento.tipo === 'error' ? 'negar' : null
    if (gesto) this.avatar.gesto?.(gesto)
    if (IMPORTANTES.includes(evento.tipo) && !(this.pestana === 'actividad' && !this.menu.hidden)) this.sinVer++
    this.pintarInsignia(evento)
    if (!this.menu.hidden && this.pestana === 'actividad') this.pintar()
  }

  private pintarInsignia(ultimo?: EventoActividad): void {
    this.insignia.hidden = this.sinVer === 0
    this.insignia.textContent = this.sinVer > 9 ? '9+' : String(this.sinVer)
    if (ultimo) this.insignia.title = `${ultimo.titulo}${ultimo.detalle ? ` — ${ultimo.detalle}` : ''}`
    this.insignia.dataset['tipo'] = ultimo?.tipo ?? ''
  }

  private alAccion(a: AccionVista): void {
    if (a.herramienta !== 'delegar') return
    if (a.estado === 'en_curso') {
      const [quien, ...que] = a.titulo.replace(/^Encargo a /, '').split(': ')
      this.encargos.set(a.accionId, {
        quien: `Agente «${quien}»`,
        que: que.join(': ') || 'Encargo del chat',
        detalle: a.resultado ?? 'Empezando…',
        desde: this.encargos.get(a.accionId)?.desde ?? Date.now()
      })
    } else this.encargos.delete(a.accionId)
    this.pintarBotonAgentes()
    if (!this.menu.hidden && this.pestana === 'agentes') this.pintar()
  }

  private async refrescarTareas(): Promise<void> {
    try {
      this.tareas = await window.orbe.tareasEstado()
    } catch {
      return
    }
    this.pintarBotonAgentes()
    if (!this.menu.hidden && this.pestana === 'agentes') this.pintar()
  }

  /** El botón late mientras algún agente trabaja. */
  private pintarBotonAgentes(): void {
    const enCurso = this.encargos.size + (this.tareas?.tareas.filter((t) => t.ultima?.estado === 'en-curso').length ?? 0)
    this.boton.classList.toggle('agentes-trabajando', enCurso > 0)
    this.boton.title = enCurso > 0 ? `Agentes: ${enCurso} trabajando` : 'Agentes: quién trabaja y en qué'
  }

  private async abrir(): Promise<void> {
    this.menus.anunciarApertura()
    this.menu.hidden = false
    this.boton.setAttribute('aria-expanded', 'true')
    if (this.pestana === 'actividad') this.marcarVistos()
    this.pintar()
    void this.refrescarTareas()
    try {
      this.estado = await window.orbe.actividadHistorial()
      this.ultimos = this.estado.eventos
      if (!this.menu.hidden) this.pintar()
    } catch {
      // sin respuesta del proceso principal, se queda lo que hubiera
    }
  }

  private cerrar(): void {
    this.menu.hidden = true
    this.boton.setAttribute('aria-expanded', 'false')
  }

  private marcarVistos(): void {
    this.sinVer = 0
    this.pintarInsignia()
  }

  private pintar(): void {
    const pestanas = el('div', 'ocr-modos')
    pestanas.setAttribute('role', 'tablist')
    const opciones: Array<['agentes' | 'actividad', string]> = [
      ['agentes', 'Trabajando ahora'],
      ['actividad', 'Avisos']
    ]
    for (const [id, nombre] of opciones) {
      const b = el('button', 'ocr-modo', nombre)
      b.type = 'button'
      b.dataset['pestana'] = id
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-checked', String(id === this.pestana))
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        this.pestana = id
        if (id === 'actividad') this.marcarVistos()
        this.pintar()
      })
      pestanas.append(b)
    }
    this.menu.replaceChildren(pestanas, ...(this.pestana === 'agentes' ? this.pintarAgentes() : this.pintarActividad()))
  }

  /** Quién trabaja ahora y en qué: tareas en segundo plano (con su agente) y encargos del chat. */
  private pintarAgentes(): HTMLElement[] {
    const lista = el('ol', 'actividad-lista')
    const fila = (quien: string, que: string, detalle: string, desde: number | null): void => {
      const li = el('li', 'actividad-item actividad-trabajando')
      const cabeza = el('div', 'actividad-cabeza')
      cabeza.append(el('span', 'actividad-tipo', 'Trabajando'), el('span', 'actividad-origen', quien))
      if (desde) cabeza.append(el('time', 'actividad-hora', new Date(desde).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })))
      li.append(cabeza, el('p', 'actividad-titulo', que))
      if (detalle) li.append(el('p', 'actividad-detalle', detalle))
      lista.append(li)
    }
    for (const a of this.encargos.values()) fila(a.quien, a.que, a.detalle, a.desde)
    for (const t of this.tareas?.tareas ?? []) {
      const u = t.ultima
      if (u && (u.estado === 'en-curso' || u.estado === 'esperando')) {
        fila(t.agente ? `Agente «${t.agente}»` : 'Orbe', t.titulo, u.estado === 'esperando' ? 'Te necesita: responde en Tareas.' : 'Tarea en segundo plano', u.inicio)
      }
    }
    if (lista.children.length === 0) {
      return [el('p', 'memoria-nota', 'Ningún agente está trabajando ahora. Aquí verás quién hace qué en cuanto Orbe reparta trabajo o empiece una tarea.')]
    }
    return [lista]
  }

  private pintarActividad(): HTMLElement[] {
    const partes: HTMLElement[] = []
    const estado = this.estado
    if (estado && !estado.activo) {
      partes.push(
        el(
          'p',
          'memoria-nota actividad-apagada',
          'Los avisos de otras herramientas están apagados. Enciéndelos en la configuración («Avisos de Claude Code y otras herramientas»).'
        )
      )
    } else if (estado?.activo) {
      partes.push(el('p', 'memoria-nota', `Escuchando avisos en este equipo (puerto ${estado.puerto}).`))
    }
    const lista = el('ol', 'actividad-lista')
    for (const ev of [...this.ultimos].reverse().slice(0, 30)) {
      const li = el('li', `actividad-item actividad-${ev.tipo}`)
      const hora = new Date(ev.cuando).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
      const cabeza = el('div', 'actividad-cabeza')
      cabeza.append(el('span', 'actividad-tipo', ETIQUETA_TIPO[ev.tipo]), el('span', 'actividad-origen', ev.origen), el('time', 'actividad-hora', hora))
      li.append(cabeza, el('p', 'actividad-titulo', ev.titulo))
      if (ev.detalle) li.append(el('p', 'actividad-detalle', ev.detalle))
      lista.append(li)
    }
    if (lista.children.length === 0) partes.push(el('p', 'memoria-nota', 'Todavía no ha llegado ningún aviso.'))
    else partes.push(lista)
    if (estado) {
      const copiar = el('button', 'boton-memoria', 'Copiar los hooks para Claude Code')
      copiar.type = 'button'
      copiar.title = 'Pégalos en ~/.claude/settings.json (o en .claude/settings.json de un proyecto)'
      copiar.addEventListener('click', (e) => {
        e.stopPropagation()
        void navigator.clipboard.writeText(estado.configClaudeCode).then(
          () => (copiar.textContent = 'Copiado: pégalo en ~/.claude/settings.json'),
          () => (copiar.textContent = 'No he podido copiarlo')
        )
      })
      partes.push(copiar)
    }
    return partes
  }
}
