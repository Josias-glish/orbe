import type { ResumenUso, TotalUso } from '../../shared/tipos'
import { crearIcono } from '../chat/contexto-ui'

const miles = new Intl.NumberFormat('es-ES')
const compacto = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 })

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (clase) e.className = clase
  if (texto !== undefined) e.textContent = texto
  return e
}

/** «$0,0123», «$1,25», «$0» (con más decimales cuanto más pequeño, para que un gasto real nunca parezca cero). */
export function formatoDolares(usd: number): string {
  if (usd === 0) return '$0'
  const decimales = usd >= 10 ? 2 : usd >= 0.1 ? 3 : 4
  return `$${usd.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: decimales })}`
}

export function formatoTokens(n: number): string {
  return n < 10_000 ? miles.format(n) : compacto.format(n)
}

const NOMBRE_PROVEEDOR = { cli: 'CLI de Claude', api: 'API de Anthropic', openai: 'API compatible' } as const

/** Texto del límite del plan que informa el CLI («Te queda margen», «Cerca del límite»…). */
export function describirLimite(l: NonNullable<ResumenUso['limiteCli']>, ahora = Date.now()): string {
  const estado = l.estado === 'allowed' ? 'Dentro del límite' : l.estado === 'allowed_warning' ? 'Cerca del límite' : l.estado === 'rejected' ? 'Límite alcanzado' : l.estado
  const tipo = l.tipo === 'five_hour' ? ' de 5 horas' : l.tipo === 'seven_day' || l.tipo === 'weekly' ? ' semanal' : ''
  let reinicio = ''
  if (l.reinicio) {
    const ms = l.reinicio * 1000 - ahora
    if (ms > 0) {
      const h = Math.floor(ms / 3_600_000)
      const m = Math.round((ms % 3_600_000) / 60_000)
      reinicio = ` · se renueva en ${h > 0 ? `${h} h ` : ''}${m} min`
    }
  }
  return `${estado} (límite${tipo} de tu plan)${reinicio}`
}

/**
 * El panel de consumo: cuántos tokens y cuánto dinero llevas gastado con cada servicio (hoy, esta semana, este mes),
 * un gráfico de los últimos 14 días y el estado del límite del plan si usas el CLI de Claude. Los dólares los da el
 * CLI o se estiman con las tarifas públicas; los servicios sin tarifa conocida (Gemini gratis, Ollama…) solo
 * cuentan tokens.
 */
export class VistaUso {
  private resumen: ResumenUso | null = null
  private confirmandoBorrar = false

  constructor(
    private readonly raiz: HTMLElement,
    private readonly alVolver: () => void
  ) {
    window.orbe.alUso(() => {
      if (this.visible) void this.cargar()
    })
  }

  get visible(): boolean {
    return !this.raiz.hidden
  }

  async abrir(): Promise<void> {
    this.raiz.hidden = false
    this.confirmandoBorrar = false
    await this.cargar()
  }

  cerrar(): void {
    this.raiz.hidden = true
  }

  private async cargar(): Promise<void> {
    try {
      this.resumen = await window.orbe.usoResumen()
      this.pintar()
    } catch {
      this.raiz.replaceChildren(el('p', 'memoria-nota', 'No he podido leer el consumo.'))
    }
  }

  private async borrar(): Promise<void> {
    if (!this.confirmandoBorrar) {
      this.confirmandoBorrar = true
      this.pintar()
      return
    }
    this.confirmandoBorrar = false
    this.resumen = await window.orbe.usoBorrar()
    this.pintar()
  }

  private tarjeta(titulo: string, t: TotalUso): HTMLElement {
    const c = el('div', 'uso-tarjeta')
    c.append(
      el('span', 'uso-tarjeta-titulo', titulo),
      el('span', 'uso-tarjeta-coste', `${formatoDolares(t.costeUsd)}${t.sinPrecio ? '+' : ''}`),
      el('span', 'uso-tarjeta-tokens', `${formatoTokens(t.entrada + t.salida)} tokens · ${miles.format(t.peticiones)} ${t.peticiones === 1 ? 'petición' : 'peticiones'}`)
    )
    return c
  }

  private grafico(dias: ResumenUso['dias']): HTMLElement {
    const caja = el('div', 'uso-grafico')
    caja.setAttribute('role', 'img')
    const maximo = Math.max(1, ...dias.map((d) => d.tokens))
    caja.setAttribute('aria-label', `Tokens por día, últimos ${dias.length} días`)
    for (const d of dias) {
      const barra = el('div', 'uso-barra')
      const alto = d.tokens === 0 ? 0 : Math.max(4, Math.round((d.tokens / maximo) * 100))
      barra.style.setProperty('--alto', `${alto}%`)
      const [, mes, dia] = d.fecha.split('-')
      barra.title = `${Number(dia)}/${Number(mes)}: ${miles.format(d.tokens)} tokens · ${formatoDolares(d.costeUsd)}`
      barra.append(el('span', 'uso-barra-relleno'), el('span', 'uso-barra-dia', String(Number(dia))))
      caja.append(barra)
    }
    return caja
  }

  private pintar(): void {
    const r = this.resumen
    if (!r) return
    const cabecera = el('div', 'memoria-cabecera')
    const volver = el('button', 'boton-icono')
    volver.type = 'button'
    volver.title = 'Volver al chat'
    volver.setAttribute('aria-label', 'Volver al chat')
    volver.append(crearIcono('volver', 18))
    volver.addEventListener('click', () => this.alVolver())
    cabecera.append(volver, el('span', 'memoria-titulo', 'Consumo'))

    const cuerpo = el('div', 'memoria-cuerpo uso-cuerpo')
    if (r.desde === null) {
      cuerpo.append(el('p', 'memoria-resumen', 'Aún no hay consumo. En cuanto Orbe responda, aquí verás los tokens y el dinero que gasta cada servicio.'))
    } else {
      const tarjetas = el('div', 'uso-tarjetas')
      tarjetas.append(this.tarjeta('Hoy', r.hoy), this.tarjeta('7 días', r.semana), this.tarjeta('Este mes', r.mes))
      cuerpo.append(tarjetas, this.grafico(r.dias))

      if (r.limiteCli) cuerpo.append(el('p', `uso-limite uso-limite-${r.limiteCli.estado}`, describirLimite(r.limiteCli)))

      if (r.porModelo.length > 0) {
        cuerpo.append(el('h3', 'uso-subtitulo', 'Este mes, por modelo'))
        const lista = el('ul', 'uso-modelos')
        for (const m of r.porModelo) {
          const li = el('li', 'uso-modelo')
          const nombre = el('div', 'uso-modelo-nombre')
          nombre.append(el('strong', undefined, m.modelo), el('span', undefined, NOMBRE_PROVEEDOR[m.proveedor]))
          const cifras = el('div', 'uso-modelo-cifras')
          cifras.append(
            el('strong', undefined, m.sinPrecio && m.costeUsd === 0 ? 'sin precio' : `${formatoDolares(m.costeUsd)}${m.sinPrecio ? '+' : ''}`),
            el('span', undefined, `${formatoTokens(m.entrada)} entrada · ${formatoTokens(m.salida)} salida${m.cache ? ` · ${formatoTokens(m.cache)} caché` : ''}`)
          )
          li.append(nombre, cifras)
          lista.append(li)
        }
        cuerpo.append(lista)
      }

      const nota = r.porModelo.some((m) => m.proveedor === 'cli')
        ? 'Con el CLI de Claude y una suscripción no pagas por token: el importe es lo que costaría con la API, para que veas cuánto aprovechas el plan.'
        : 'Los dólares se estiman con las tarifas públicas. «sin precio» o «+»: servicios cuya tarifa Orbe no conoce (p. ej., Gemini gratis); solo se cuentan sus tokens.'
      cuerpo.append(el('p', 'memoria-nota', nota))

      const total = el('p', 'memoria-nota', `Total desde ${new Date(r.desde).toLocaleDateString('es-ES')}: ${formatoDolares(r.total.costeUsd)}${r.total.sinPrecio ? '+' : ''} · ${formatoTokens(r.total.entrada + r.total.salida)} tokens.`)
      const borrar = el('button', this.confirmandoBorrar ? 'boton-memoria peligro' : 'boton-memoria', this.confirmandoBorrar ? 'Pulsa otra vez para borrar el historial' : 'Poner a cero')
      borrar.type = 'button'
      borrar.addEventListener('click', () => void this.borrar())
      cuerpo.append(total, borrar)
    }
    this.raiz.replaceChildren(cabecera, cuerpo)
  }
}
