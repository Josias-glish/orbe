import { CUANDO_APLICA, DESCRIPCION_NIVEL, NOMBRE_NIVEL } from '../../shared/potencia'
import { NIVELES_ESFUERZO, type InfoPotencia, type NivelEsfuerzo } from '../../shared/tipos'
import { registrarMenu } from './menus'

/** Grados que gira la aguja del icono para cada nivel (de -70° a 70° respecto a la vertical). */
const AGUJA_GRADOS: Record<NivelEsfuerzo, number> = { low: -70, medium: -35, high: 0, xhigh: 35, max: 70 }

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (clase) e.className = clase
  if (texto !== undefined) e.textContent = texto
  return e
}

/**
 * El marcador de potencia de la cabecera: un cuentakilómetros cuya aguja marca cuánto «piensa» el modelo. Al pulsarlo
 * se abre un deslizador de cinco niveles, de Rápido a Máximo. Más potencia da respuestas más cuidadas, pero más lentas
 * y con más gasto del plan o del crédito.
 */
export class MenuPotencia {
  private info: InfoPotencia = { nivel: 'medium', aplica: 'ahora' }
  private readonly menus: { anunciarApertura(): void }

  constructor(
    private readonly boton: HTMLButtonElement,
    private readonly menu: HTMLElement
  ) {
    this.menus = registrarMenu('potencia', () => this.cerrar())
    boton.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.menu.hidden) void this.abrir()
      else this.cerrar()
    })
    document.addEventListener('click', (e) => {
      // La ruta del evento se calcula al lanzarlo: sigue valiendo aunque el elemento pulsado ya se haya repintado.
      if (!this.menu.hidden && !e.composedPath().includes(this.menu)) this.cerrar()
    })
    this.pintarBoton()
    void this.cargar()
  }

  cerrarSiAbierto(): boolean {
    if (this.menu.hidden) return false
    this.cerrar()
    return true
  }

  private async cargar(): Promise<void> {
    try {
      this.info = await window.orbe.potenciaInfo()
    } catch {
      // Sin el dato el marcador se queda en el punto medio.
    }
    this.pintarBoton()
  }

  private async abrir(): Promise<void> {
    this.menus.anunciarApertura()
    await this.cargar()
    this.menu.hidden = false
    this.boton.setAttribute('aria-expanded', 'true')
    this.pintar()
  }

  private cerrar(): void {
    this.menu.hidden = true
    this.boton.setAttribute('aria-expanded', 'false')
  }

  private pintarBoton(nivel: NivelEsfuerzo = this.info.nivel): void {
    this.boton.dataset['nivel'] = nivel
    this.boton.style.setProperty('--aguja', `${AGUJA_GRADOS[nivel]}deg`)
    this.boton.title = `Potencia del modelo: ${NOMBRE_NIVEL[nivel]}`
  }

  private pintar(): void {
    const nivelActual = this.info.nivel
    const titulo = el('p', 'potencia-titulo', 'Potencia del modelo')
    const nombre = el('span', 'potencia-nombre', NOMBRE_NIVEL[nivelActual])
    const descripcion = el('p', 'memoria-nota potencia-descripcion', DESCRIPCION_NIVEL[nivelActual])

    const fila = el('label', 'fondo-visibilidad')
    const rango = el('input')
    rango.type = 'range'
    rango.min = '0'
    rango.max = String(NIVELES_ESFUERZO.length - 1)
    rango.step = '1'
    rango.value = String(NIVELES_ESFUERZO.indexOf(nivelActual))
    rango.setAttribute('aria-label', 'Potencia del modelo')
    rango.setAttribute('aria-valuetext', NOMBRE_NIVEL[nivelActual])
    const escala = el('div', 'potencia-escala')
    escala.append(el('span', undefined, 'Rápido'), el('span', undefined, 'Máximo'))
    fila.append(rango, escala)

    const costo = el('p', 'memoria-nota potencia-costo', 'Más potencia: respuestas más cuidadas, pero más lentas y con más gasto de tu plan o crédito.')
    costo.hidden = nivelActual === 'low' || nivelActual === 'medium'
    const cuando = el('p', 'memoria-nota', CUANDO_APLICA[this.info.aplica])

    const nivelDe = (): NivelEsfuerzo => NIVELES_ESFUERZO[Number(rango.value)] ?? 'medium'
    rango.addEventListener('input', () => {
      const nivel = nivelDe()
      nombre.textContent = NOMBRE_NIVEL[nivel]
      descripcion.textContent = DESCRIPCION_NIVEL[nivel]
      rango.setAttribute('aria-valuetext', NOMBRE_NIVEL[nivel])
      costo.hidden = nivel === 'low' || nivel === 'medium'
      this.pintarBoton(nivel)
    })
    rango.addEventListener('change', () => {
      const nivel = nivelDe()
      void window.orbe
        .potenciaFijar(nivel)
        .then((info) => {
          this.info = info
          this.pintarBoton()
        })
        .catch(() => this.pintarBoton())
    })

    const cabecera = el('div', 'potencia-cabecera')
    cabecera.append(titulo, nombre)
    this.menu.replaceChildren(cabecera, fila, descripcion, costo, cuando)
  }
}
