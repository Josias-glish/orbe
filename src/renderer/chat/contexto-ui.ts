import type { ClaveParte, LecturaPantalla, ParteContexto } from '../../shared/tipos'

const NS = 'http://www.w3.org/2000/svg'

/** Trazos (estilo Lucide, dibujados a mano) de cada icono. */
const ICONOS: Record<ClaveParte | 'ojo' | 'cerrar' | 'libro' | 'volver' | 'marca', string[]> = {
  ventana: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M3 9h18'],
  seleccion: ['M9 4h6', 'M9 20h6', 'M12 4v16'],
  contenido: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6', 'M9 17h6'],
  imagen: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M9 10.5h.01', 'm21 16-5-5-9 9'],
  ojo: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  cerrar: ['M18 6 6 18', 'm6 6 12 12'],
  libro: ['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'],
  volver: ['M19 12H5', 'm12 19-7-7 7-7'],
  marca: ['M20 6 9 17l-5-5']
}

export function crearIcono(nombre: keyof typeof ICONOS, tamano = 14): SVGElement {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(tamano))
  svg.setAttribute('height', String(tamano))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.9')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of ICONOS[nombre]) {
    const trazo = document.createElementNS(NS, 'path')
    trazo.setAttribute('d', d)
    svg.append(trazo)
  }
  return svg
}

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (clase) e.className = clase
  if (texto !== undefined) e.textContent = texto
  return e
}

/** Panel con el texto exacto (recortado) que lleva un trozo de contexto. */
function crearVista(parte: ParteContexto): HTMLElement {
  const caja = el('div', 'chip-vista')
  caja.append(el('pre', 'chip-vista-texto', parte.vista))
  if (parte.caracteres && parte.caracteres > parte.vista.length) {
    caja.append(el('p', 'chip-vista-nota', 'Vista previa. Se envía el texto completo.'))
  }
  return caja
}

/** Un chip: icono, etiqueta y resumen. Al pulsarlo se despliega la vista previa de lo que lleva. */
function crearChip(parte: ParteContexto, alAlternar: () => void): HTMLButtonElement {
  const boton = el('button', `chip chip-${parte.clave}`)
  boton.type = 'button'
  boton.title = `${parte.etiqueta}: ${parte.resumen}. Pulsa para ver lo que se envía.`
  boton.setAttribute('aria-expanded', 'false')
  boton.append(crearIcono(parte.clave), el('span', 'chip-etiqueta', parte.etiqueta), el('span', 'chip-resumen', parte.resumen))
  boton.addEventListener('click', alAlternar)
  return boton
}

/**
 * Chips de solo lectura para la burbuja del usuario: muestran qué contexto de pantalla viajó con ese
 * mensaje (ventana, selección, contenido o captura).
 */
export function crearChipsAdjuntos(partes: ParteContexto[]): HTMLElement {
  const contenedor = el('div', 'adjuntos')
  const fila = el('div', 'adjuntos-fila')
  const vista = el('div', 'adjuntos-vista')
  let abierta: ClaveParte | null = null

  for (const parte of partes) {
    const chip = crearChip(parte, () => {
      vista.replaceChildren()
      fila.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-expanded', 'false'))
      if (abierta === parte.clave) {
        abierta = null
        return
      }
      abierta = parte.clave
      chip.setAttribute('aria-expanded', 'true')
      vista.append(crearVista(parte))
    })
    fila.append(chip)
  }
  contenedor.append(el('span', 'adjuntos-titulo', 'Enviado con este mensaje'), fila, vista)
  return contenedor
}

/** Barra sobre el campo de texto con el contexto leído que irá con el próximo mensaje. */
export class BarraContexto {
  private abierta: ClaveParte | null = null
  private lectura: LecturaPantalla | null = null

  constructor(
    private readonly contenedor: HTMLElement,
    private readonly alQuitar: (clave: ClaveParte) => void,
    private readonly alDescartar: () => void
  ) {}

  hay(): boolean {
    return this.lectura !== null
  }

  mostrar(lectura: LecturaPantalla): void {
    this.lectura = lectura
    if (this.abierta && !lectura.partes.some((p) => p.clave === this.abierta)) this.abierta = null
    this.pintar()
  }

  limpiar(): void {
    this.lectura = null
    this.abierta = null
    this.contenedor.replaceChildren()
    this.contenedor.hidden = true
  }

  private pintar(): void {
    const lectura = this.lectura
    if (!lectura || lectura.partes.length === 0) {
      this.limpiar()
      return
    }
    this.contenedor.hidden = false

    const cabecera = el('div', 'pendiente-cabecera')
    const titulo = el('span', 'pendiente-titulo', 'Se enviará con tu próximo mensaje')
    const descartar = el('button', 'pendiente-descartar', 'Descartar')
    descartar.type = 'button'
    descartar.addEventListener('click', () => this.alDescartar())
    cabecera.append(titulo, descartar)

    const fila = el('div', 'pendiente-fila')
    for (const parte of lectura.partes) {
      const envoltorio = el('div', 'chip-con-quitar')
      const chip = crearChip(parte, () => {
        this.abierta = this.abierta === parte.clave ? null : parte.clave
        this.pintar()
      })
      chip.setAttribute('aria-expanded', String(this.abierta === parte.clave))
      const quitar = el('button', 'chip-quitar')
      quitar.type = 'button'
      quitar.title = `No enviar: ${parte.etiqueta}`
      quitar.setAttribute('aria-label', `No enviar: ${parte.etiqueta}`)
      quitar.append(crearIcono('cerrar', 12))
      quitar.addEventListener('click', () => this.alQuitar(parte.clave))
      envoltorio.append(chip, quitar)
      fila.append(envoltorio)
    }

    const hijos: HTMLElement[] = [cabecera, fila]
    const abierta = lectura.partes.find((p) => p.clave === this.abierta)
    if (abierta) hijos.push(crearVista(abierta))
    for (const aviso of lectura.avisos) hijos.push(el('p', 'pendiente-aviso', aviso))
    this.contenedor.replaceChildren(...hijos)
  }
}
