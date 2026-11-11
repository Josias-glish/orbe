import type { InformeMetricas, MarcaContenido, PublicacionMetricas } from '../../shared/tipos'
import { crearIcono } from '../chat/contexto-ui'

const CUENTAS: Array<[MarcaContenido, string]> = [
  ['jsdesign', 'J&S Design'],
  ['morfy', 'morfy'],
  ['personal', 'Personal']
]
const NOMBRE = Object.fromEntries(CUENTAS) as Record<MarcaContenido, string>
const miles = new Intl.NumberFormat('es-ES')

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (clase) e.className = clase
  if (texto !== undefined) e.textContent = texto
  return e
}

function boton(texto: string, clase: string, alPulsar: () => void): HTMLButtonElement {
  const b = el('button', clase, texto)
  b.type = 'button'
  b.addEventListener('click', alPulsar)
  return b
}

const cifra = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : miles.format(n))

/** «+35 %» / «−20 %» frente a la media, o `null` si no hay con qué comparar. */
export function frenteAMedia(valor: number | undefined, media: number | null): { texto: string; arriba: boolean } | null {
  if (valor === undefined || !media) return null
  const pct = Math.round(((valor - media) / media) * 100)
  return { texto: `${pct >= 0 ? '+' : '−'}${Math.abs(pct)} %`, arriba: pct >= 0 }
}

/** El encargo que va al chat al pulsar «Analizar»: Claude como experto en crecimiento, con sus herramientas de lectura. */
export function encargoAnalisis(cuenta: MarcaContenido): string {
  return [
    `Analiza mi cuenta de Instagram de ${NOMBRE[cuenta]} como experto en crecimiento de cuentas y marcas personales.`,
    `Usa ig_crecimiento, ig_metricas y contenido_ficha_marca (cuenta y marca «${cuenta}»).`,
    'Dame, sin relleno y sin inventar cifras:',
    '1. Diagnóstico en 3 líneas, con números (crecimiento, alcance y tasa de interacción frente a la media).',
    '2. Qué funcionó y por qué: tema, gancho de los primeros segundos o la primera línea, formato y hora.',
    '3. Qué dejar de hacer.',
    '4. Tres acciones concretas para esta semana (qué publicar, en qué formato, cuántas veces y a qué horas).',
    '5. Dos ideas de publicación listas para producir, con gancho y texto de la imagen.',
    'Si te digo «guárdalas», guárdalas en Contenido con contenido_proponer.'
  ].join('\n')
}

/**
 * La pestaña «Métricas»: por cuenta, seguidores y su crecimiento, medias de alcance y de interacción, la evolución
 * guardada día a día y cada publicación reciente frente a la media. «Analizar» manda el encargo al chat.
 */
export class VistaMetricas {
  private cuenta: MarcaContenido = 'jsdesign'
  private informe: InformeMetricas | null = null
  private error = ''
  private cargando = false

  constructor(
    private readonly raiz: HTMLElement,
    private readonly alVolver: () => void,
    private readonly alAnalizar: (encargo: string) => void
  ) {}

  get visible(): boolean {
    return !this.raiz.hidden
  }

  async abrir(): Promise<void> {
    this.raiz.hidden = false
    await this.cargar(false)
  }

  cerrar(): void {
    this.raiz.hidden = true
  }

  private async cargar(actualizar: boolean): Promise<void> {
    this.cargando = true
    this.pintar()
    try {
      const r = await window.orbe.metricasLeer(this.cuenta, actualizar)
      this.informe = r.informe
      this.error = r.ok ? '' : r.error
    } catch {
      this.error = 'No he podido leer las métricas.'
    }
    this.cargando = false
    this.pintar()
  }

  private tarjeta(titulo: string, valor: string, detalle: string): HTMLElement {
    const c = el('div', 'uso-tarjeta')
    c.append(el('span', 'uso-tarjeta-titulo', titulo), el('span', 'uso-tarjeta-coste', valor), el('span', 'uso-tarjeta-tokens', detalle))
    return c
  }

  private grafico(i: InformeMetricas): HTMLElement {
    const dias = i.historial.slice(-14)
    const caja = el('div', 'uso-grafico')
    caja.setAttribute('role', 'img')
    caja.setAttribute('aria-label', `Seguidores por día, últimos ${dias.length} días guardados`)
    const min = Math.min(...dias.map((d) => d.seguidores))
    const max = Math.max(...dias.map((d) => d.seguidores))
    for (const d of dias) {
      const barra = el('div', 'uso-barra')
      // Escala desde el mínimo del periodo (con un suelo del 15 %) para que se note el cambio.
      const alto = max === min ? 60 : 15 + Math.round(((d.seguidores - min) / (max - min)) * 85)
      barra.style.setProperty('--alto', `${alto}%`)
      const [, mes, dd] = d.fecha.split('-')
      barra.title = `${Number(dd)}/${Number(mes)}: ${miles.format(d.seguidores)} seguidores`
      barra.append(el('span', 'uso-barra-relleno'), el('span', 'uso-barra-dia', String(Number(dd))))
      caja.append(barra)
    }
    return caja
  }

  private fila(p: PublicacionMetricas, i: InformeMetricas): HTMLElement {
    const li = el('li', 'uso-modelo metricas-pub')
    const nombre = el('div', 'uso-modelo-nombre')
    const fecha = p.fecha ? new Date(p.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : ''
    nombre.append(el('strong', undefined, `${p.tipo} · ${fecha}`), el('span', undefined, p.pie || '(sin pie)'))
    const cifras = el('div', 'uso-modelo-cifras')
    const comp = frenteAMedia(p.alcance, i.medias.alcance)
    const alcance = el('strong', undefined, `${cifra(p.alcance)} alcance`)
    if (comp) alcance.append(el('span', comp.arriba ? 'metricas-arriba' : 'metricas-abajo', ` ${comp.texto}`))
    cifras.append(
      alcance,
      el('span', undefined, `${cifra(p.tasa)} % interacción · ${cifra(p.guardados)} guardados · ${cifra(p.compartidos)} compartidos`)
    )
    li.append(nombre, cifras)
    if (p.enlace) {
      li.tabIndex = 0
      li.title = 'Abrir en Instagram'
      li.addEventListener('click', () => window.orbe.abrirEnlace(p.enlace))
    }
    return li
  }

  private pintar(): void {
    const cabecera = el('div', 'memoria-cabecera')
    const volver = el('button', 'boton-icono')
    volver.type = 'button'
    volver.title = 'Volver al chat'
    volver.setAttribute('aria-label', 'Volver al chat')
    volver.append(crearIcono('volver', 18))
    volver.addEventListener('click', () => this.alVolver())
    cabecera.append(volver, el('span', 'memoria-titulo', 'Métricas'))

    const cuerpo = el('div', 'memoria-cuerpo uso-cuerpo')
    const pestanas = el('div', 'tareas-pestanas')
    pestanas.setAttribute('role', 'tablist')
    for (const [valor, texto] of CUENTAS) {
      const b = boton(texto, 'tareas-pestana', () => {
        if (this.cuenta === valor) return
        this.cuenta = valor
        this.informe = null
        this.error = ''
        void this.cargar(false)
      })
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', String(this.cuenta === valor))
      pestanas.append(b)
    }
    const acciones = el('div', 'tarea-acciones')
    const actualizar = boton(this.cargando ? 'Leyendo…' : 'Actualizar', 'boton-memoria', () => void this.cargar(true))
    actualizar.disabled = this.cargando
    acciones.append(actualizar, boton('Analizar con Claude', 'boton-memoria primario', () => this.alAnalizar(encargoAnalisis(this.cuenta))))
    cuerpo.append(pestanas, acciones)

    if (this.error) cuerpo.append(el('p', 'memoria-error', this.error))
    const i = this.informe
    if (!i) {
      if (!this.cargando && !this.error) cuerpo.append(el('p', 'tareas-vacio', 'Pulsa «Actualizar» para leer las métricas de esta cuenta.'))
    } else {
      if (i.avisoMetricas) cuerpo.append(el('p', 'memoria-error', `Faltan las cifras detalladas: ${i.avisoMetricas}`))
      const crec = (n: number | null, dias: number): string => (n === null ? `${dias} días: sin datos aún` : `${n >= 0 ? '+' : ''}${miles.format(n)} en ${dias} días`)
      const tarjetas = el('div', 'uso-tarjetas')
      tarjetas.append(
        this.tarjeta('Seguidores', cifra(i.seguidores), crec(i.crecimiento.dias7, 7)),
        this.tarjeta('Alcance medio', cifra(i.medias.alcance), `últimas ${i.publicaciones.length} publicaciones`),
        this.tarjeta('Interacción', i.medias.tasa === null ? '—' : `${cifra(i.medias.tasa)} %`, 'sobre el alcance')
      )
      cuerpo.append(tarjetas)
      if (i.historial.length >= 2) cuerpo.append(el('h3', 'uso-subtitulo', 'Seguidores por día'), this.grafico(i))
      cuerpo.append(el('h3', 'uso-subtitulo', `Publicaciones de @${i.usuario}`))
      const lista = el('ul', 'uso-modelos')
      for (const p of i.publicaciones) lista.append(this.fila(p, i))
      cuerpo.append(lista)
      cuerpo.append(
        el('p', 'memoria-nota', `Leído ${new Date(i.leido).toLocaleString('es-ES')}. Meta puede tardar hasta 48 h en tener las cifras de una publicación nueva. ${crec(i.crecimiento.dias30, 30)}.`)
      )
    }
    this.raiz.replaceChildren(cabecera, cuerpo)
  }
}
