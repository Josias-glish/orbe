import type { EstadoContenido, MarcaContenido } from '../../shared/tipos'
import { crearIcono } from '../chat/contexto-ui'

type PiezaVista = EstadoContenido['piezas'][number]

const MARCAS: Array<[MarcaContenido, string]> = [
  ['jsdesign', 'J&S Design'],
  ['morfy', 'morfy'],
  ['personal', 'Personal']
]
const NOMBRE = Object.fromEntries(MARCAS) as Record<MarcaContenido, string>
/** Mientras la pestaña está abierta se mira la carpeta de entrada cada pocos segundos. */
const CADA_MS = 4000

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

/** Estado de una pieza en palabras: lo que le falta para estar lista. */
export function estadoPieza(p: Pick<PiezaVista, 'aprobada' | 'archivos' | 'disenando'>): string {
  if (p.disenando) return 'Diseñando…'
  if (p.aprobada) return 'Aprobada'
  if (p.archivos.length === 0) return 'Falta la imagen'
  return p.archivos.length > 1 ? `Carrusel de ${p.archivos.length}: por aprobar` : 'Por aprobar'
}

/**
 * La pestaña «Contenido»: las propuestas de publicación de cada marca. «Diseñar» hace la imagen sola (CLI de Claude →
 * HTML → PNG); «En Claude Design» es la alternativa manual. Aprobar no publica nada (Etapa 4).
 */
export class VistaContenido {
  private estado: EstadoContenido | null = null
  private filtro: MarcaContenido | null = null
  private confirmandoBorrar: string | null = null
  private temporizador = 0
  /** Lo que el usuario está escribiendo no se pisa al refrescar. */
  private editando = false

  constructor(
    private readonly raiz: HTMLElement,
    private readonly alVolver: () => void
  ) {
    window.orbe.alContenido(() => {
      if (this.visible) void this.cargar()
    })
    raiz.addEventListener('focusin', (e) => (this.editando = (e.target as HTMLElement).matches('textarea, input')))
    raiz.addEventListener('focusout', () => (this.editando = false))
  }

  get visible(): boolean {
    return !this.raiz.hidden
  }

  async abrir(): Promise<void> {
    this.raiz.hidden = false
    this.confirmandoBorrar = null
    await this.cargar()
    window.clearInterval(this.temporizador)
    this.temporizador = window.setInterval(() => {
      if (this.visible && !this.editando) void this.cargar()
    }, CADA_MS)
  }

  cerrar(): void {
    this.raiz.hidden = true
    window.clearInterval(this.temporizador)
  }

  private async cargar(): Promise<void> {
    await this.hacer(() => window.orbe.contenidoEstado())
  }

  private async hacer(accion: () => Promise<EstadoContenido>): Promise<void> {
    try {
      this.estado = await accion()
      this.pintar()
    } catch (e) {
      this.pintar(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'No he podido hacerlo.')
    }
  }

  private tarjeta(p: PiezaVista): HTMLElement {
    const c = el('article', 'tarea contenido-pieza')
    c.dataset.id = p.id
    const titulo = el('div', 'tarea-titulo')
    titulo.append(el('strong', undefined, p.idea || '(sin idea)'), el('span', 'tarea-insignia', `${NOMBRE[p.marca]} · ${estadoPieza(p)}`))
    c.append(titulo)
    if (p.errorDiseno) c.append(el('p', 'memoria-error', `No he podido diseñarla: ${p.errorDiseno}`))

    if (p.miniaturas.length > 0) {
      const fila = el('div', 'contenido-miniaturas')
      for (const src of p.miniaturas) {
        const img = el('img')
        img.src = src
        img.alt = `Imagen de la pieza ${p.id}`
        fila.append(img)
      }
      c.append(fila)
    }

    const campo = (etiqueta: string, valor: string, filas: number): HTMLTextAreaElement => {
      const caja = el('label', 'tareas-campo')
      const t = el('textarea', 'memoria-campo')
      t.rows = filas
      t.value = valor
      caja.append(el('span', undefined, etiqueta), t)
      c.append(caja)
      return t
    }
    const texto = campo('Texto de la imagen', p.texto, 2)
    const pie = campo('Pie de foto', p.pie, 4)
    const hashtags = campo('Hashtags', p.hashtags.join(' '), 1)
    const imagen = campo('Foto de fondo con Higgsfield (descripción; vacío = sin foto)', p.imagen ?? '', 2)

    const acciones = el('div', 'tarea-acciones')
    acciones.append(
      boton('Guardar texto', 'boton-memoria', () =>
        void this.hacer(() =>
          window.orbe.contenidoActualizar(p.id, { texto: texto.value, pie: pie.value, hashtags: hashtags.value.split(/\s+/).filter(Boolean), imagen: imagen.value.trim() })
        )
      ),
      boton(p.archivos.length > 0 ? 'Rediseñar' : 'Diseñar', 'boton-memoria', () => void this.hacer(() => window.orbe.contenidoDisenar(p.id))),
      boton('En Claude Design', 'boton-memoria', () => void window.orbe.contenidoClaudeDesign(p.id).then(() => this.pintar(undefined, 'Encargo copiado: pégalo en Claude Design y exporta el PNG a la carpeta de la marca.'))),
      boton('Carpeta', 'boton-memoria', () => window.orbe.contenidoCarpeta(p.marca)),
      boton(p.aprobada ? 'Quitar aprobación' : 'Aprobar', p.aprobada ? 'boton-memoria' : 'boton-memoria primario', () =>
        void this.hacer(() => window.orbe.contenidoAprobar(p.id, !p.aprobada))
      ),
      boton(this.confirmandoBorrar === p.id ? 'Pulsa otra vez para borrar' : 'Borrar', this.confirmandoBorrar === p.id ? 'boton-memoria peligro confirmar' : 'boton-memoria peligro', () => {
        if (this.confirmandoBorrar !== p.id) {
          this.confirmandoBorrar = p.id
          this.pintar()
          return
        }
        this.confirmandoBorrar = null
        void this.hacer(() => window.orbe.contenidoBorrar(p.id))
      })
    )
    c.append(acciones)
    return c
  }

  private pintar(error?: string, aviso?: string): void {
    const cabecera = el('div', 'memoria-cabecera')
    const volver = el('button', 'boton-icono')
    volver.type = 'button'
    volver.title = 'Volver al chat'
    volver.setAttribute('aria-label', 'Volver al chat')
    volver.append(crearIcono('volver', 18))
    volver.addEventListener('click', () => this.alVolver())
    cabecera.append(volver, el('span', 'memoria-titulo', 'Contenido'))

    const cuerpo = el('div', 'memoria-cuerpo contenido-cuerpo')
    const pestanas = el('div', 'tareas-pestanas')
    pestanas.setAttribute('role', 'tablist')
    for (const [valor, texto] of [[null, 'Todas'], ...MARCAS] as Array<[MarcaContenido | null, string]>) {
      const b = boton(texto, 'tareas-pestana', () => {
        this.filtro = valor
        this.pintar()
      })
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', String(this.filtro === valor))
      pestanas.append(b)
    }
    cuerpo.append(pestanas)
    if (error) cuerpo.append(el('p', 'memoria-error', error))
    if (aviso) cuerpo.append(el('p', 'memoria-nota contenido-aviso', aviso))
    for (const a of this.estado?.avisos ?? []) cuerpo.append(el('p', 'memoria-error', `No vale: ${a}`))

    const piezas = (this.estado?.piezas ?? []).filter((p) => !this.filtro || p.marca === this.filtro)
    if (piezas.length === 0) {
      cuerpo.append(
        el('p', 'tareas-vacio', 'Aún no hay piezas. Pide en el chat «propón un post para morfy sobre…»: Orbe escribe el texto y diseña la imagen solo.')
      )
    } else {
      for (const p of piezas) cuerpo.append(this.tarjeta(p))
    }
    cuerpo.append(el('p', 'memoria-nota', 'Todo se queda en este equipo. Aprobar solo marca la pieza como lista; publicar llegará en la siguiente etapa.'))
    this.raiz.replaceChildren(cabecera, cuerpo)
  }
}
