import { EXPRESIONES, IDS_EXPRESION, esIdExpresion, type IdExpresion } from '../../shared/expresiones'
import type { EstadoActividad, EventoActividad, TipoActividad } from '../../shared/tipos'
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
 * El menú del personaje (cabecera del panel): elegir una de las 20 expresiones (o dejarlo en automático) y ver la
 * actividad de las herramientas conectadas (Claude Code y otras). También pinta el globito con los avisos sin ver.
 */
export class MenuPersonaje {
  private readonly menus: { anunciarApertura(): void }
  private pestana: 'expresiones' | 'actividad' = 'expresiones'
  private fijada: IdExpresion | null = null
  private sinVer = 0
  private ultimos: EventoActividad[] = []
  private estado: EstadoActividad | null = null

  constructor(
    private readonly avatar: Avatar,
    private readonly boton: HTMLButtonElement,
    private readonly menu: HTMLElement,
    private readonly insignia: HTMLElement,
    private readonly conCara: boolean
  ) {
    this.menus = registrarMenu('personaje', () => this.cerrar())
    if (!conCara) this.pestana = 'actividad'
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

  private async abrir(): Promise<void> {
    this.menus.anunciarApertura()
    this.menu.hidden = false
    this.boton.setAttribute('aria-expanded', 'true')
    if (this.pestana === 'actividad') this.marcarVistos()
    this.pintar()
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
    const opciones: Array<['expresiones' | 'actividad', string]> = this.conCara ? [['expresiones', 'Expresiones'], ['actividad', 'Actividad']] : [['actividad', 'Actividad']]
    if (opciones.length === 1) pestanas.style.gridTemplateColumns = '1fr'
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
    this.menu.replaceChildren(pestanas, ...(this.pestana === 'expresiones' ? this.pintarExpresiones() : this.pintarActividad()))
  }

  private pintarExpresiones(): HTMLElement[] {
    const rejilla = el('div', 'expresiones-rejilla')
    for (const id of IDS_EXPRESION) {
      const ex = EXPRESIONES[id]
      const b = el('button', 'expresion-boton', ex.emoji)
      b.type = 'button'
      b.title = ex.nombre
      b.dataset['expresion'] = id
      b.setAttribute('aria-label', ex.nombre)
      b.setAttribute('aria-pressed', String(this.fijada === id))
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        // Pulsar la que ya está fijada la suelta; otra, la fija.
        this.fijada = this.fijada === id ? null : id
        this.avatar.expresar(this.fijada, 0)
        this.pintar()
      })
      rejilla.append(b)
    }
    const auto = el('button', 'boton-memoria', this.fijada ? `Automático (ahora: ${EXPRESIONES[this.fijada].nombre})` : 'Automático ✓')
    auto.type = 'button'
    auto.dataset['expresion'] = 'auto'
    auto.addEventListener('click', (e) => {
      e.stopPropagation()
      this.fijada = null
      this.avatar.expresar(null)
      this.pintar()
    })
    const nota = el(
      'p',
      'memoria-nota',
      'Pulsa una para fijarla; en automático cambia según la conversación y los avisos. Sobre el personaje: la rueda del ratón recorre las caras y si lo acaricias con el cursor, reacciona.'
    )
    return [rejilla, auto, nota]
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
