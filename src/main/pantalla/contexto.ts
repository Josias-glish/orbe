import type { ContextoPantalla, LecturaPantalla, ParteContexto } from '../../shared/tipos'
import { ErrorChat, crearError } from '../chat/errores'
import { ClienteHelper, ErrorHelper } from './helper-uia'
import { contenidoUtil } from './heuristica'
import { limpiarTexto, normalizarBarra, sanearUrl, vistaPrevia } from './limpieza'

/** Lo que el lector de pantalla sabe de una ventana. */
export interface VentanaUia {
  hwnd: number
  pid: number
  proceso: string
  aplicacion: string
  titulo: string
  esNavegador: boolean
  url: string | null
  /** Texto de la barra de direcciones (sin esquema), como respaldo de `url`. */
  barra: string | null
  primerPlano: boolean
  /** No se pudo inspeccionar el proceso (normalmente porque se ejecuta como administrador). */
  restringida: boolean
  /** Posición de la ventana en píxeles de pantalla (para saber en qué monitor está). */
  rect?: { x: number; y: number; ancho: number; alto: number } | null
}

export interface TextoUia {
  texto: string | null
  metodo: string | null
}

export interface ContenidoUia extends TextoUia {
  parcial: boolean
}

/** Origen de los datos de la pantalla; en producción es UI Automation, en las pruebas un simulacro. */
export interface FuenteUia {
  /** La ventana a leer (la que está en primer plano, o la última que estuvo), o null si no hay. */
  ventana(): Promise<VentanaUia | null>
  seleccion(hwnd: number, max: number): Promise<TextoUia>
  contenido(hwnd: number, max: number): Promise<ContenidoUia>
}

export class FuenteHelper implements FuenteUia {
  constructor(private readonly cliente: ClienteHelper) {}

  async ventana(): Promise<VentanaUia | null> {
    const r = await this.cliente.pedir<{ ventana: VentanaUia | null }>('ventana', {}, 9000)
    return r.ventana
  }

  seleccion(hwnd: number, max: number): Promise<TextoUia> {
    return this.cliente.pedir<TextoUia>('seleccion', { hwnd, max }, 9000)
  }

  contenido(hwnd: number, max: number): Promise<ContenidoUia> {
    return this.cliente.pedir<ContenidoUia>('contenido', { hwnd, max }, 12000)
  }
}

export interface ResultadoLectura {
  contexto: ContextoPantalla
  lectura: LecturaPantalla
}

export const VISTA_MAX = 1200
export const TITULO_RESUMEN_MAX = 70

/** Convierte lo que se sabe de la ventana en las líneas que se envían (y se muestran en la vista previa). */
export function describirVentana(v: NonNullable<ContextoPantalla['ventana']>): string {
  const lineas = [`Aplicación: ${v.aplicacion}`, `Título: ${v.titulo || '(sin título)'}`]
  if (v.url) lineas.push(`Dirección: ${v.url}`)
  return lineas.join('\n')
}

/**
 * Lee la pantalla bajo demanda, por orden de prioridad: (a) texto seleccionado, (b) datos de la
 * ventana activa y (c) su contenido. Si hay selección no se añade el contenido entero, que sería ruido.
 * La captura de pantalla (d) es otro paso, con confirmación, y no entra aquí.
 */
export class ServicioPantalla {
  private lecturaEnCurso: Promise<ResultadoLectura> | null = null

  constructor(
    private readonly fuente: FuenteUia,
    private readonly opciones: { contextoMax: number }
  ) {}

  /** Varias peticiones seguidas comparten la misma lectura. */
  leer(): Promise<ResultadoLectura> {
    if (!this.lecturaEnCurso) {
      this.lecturaEnCurso = this.leerDeVerdad().finally(() => {
        this.lecturaEnCurso = null
      })
    }
    return this.lecturaEnCurso
  }

  private async leerDeVerdad(): Promise<ResultadoLectura> {
    const max = this.opciones.contextoMax
    const crudo = Math.min(max * 2, 120_000) // margen para lo que la limpieza descarte

    let ventana: VentanaUia | null
    try {
      ventana = await this.fuente.ventana()
    } catch (e) {
      throw this.errorDelLector(e)
    }
    if (!ventana) throw new ErrorChat(crearError('sin_ventana'))

    const avisos: string[] = []
    const url = this.direccionDe(ventana)
    const contexto: ContextoPantalla = {
      ventana: { aplicacion: ventana.aplicacion, titulo: ventana.titulo.trim(), ...(url ? { url: url.url } : {}) }
    }
    const partes: ParteContexto[] = [this.parteVentana(contexto.ventana!, url?.parametrosOmitidos ?? false)]

    // (a) Texto seleccionado
    let seleccion: string | null = null
    try {
      seleccion = (await this.fuente.seleccion(ventana.hwnd, crudo)).texto
    } catch {
      avisos.push('No he podido comprobar si hay texto seleccionado.')
    }
    const limpioSeleccion = seleccion ? limpiarTexto(seleccion, max) : null
    if (limpioSeleccion && limpioSeleccion.texto) {
      contexto.seleccion = limpioSeleccion.texto
      if (limpioSeleccion.recortado) contexto.seleccionRecortada = true
      partes.push(this.parteTexto('seleccion', 'Selección', limpioSeleccion.texto, limpioSeleccion.caracteresOriginales, limpioSeleccion.recortado))
      return { contexto, lectura: { partes, avisos, sugerirCaptura: false } }
    }

    // (c) Contenido de la ventana
    let contenido: string | null = null
    try {
      contenido = (await this.fuente.contenido(ventana.hwnd, crudo)).texto
    } catch {
      avisos.push('No he podido leer el contenido de esa ventana.')
    }
    const limpioContenido = contenido ? limpiarTexto(contenido, max) : null
    if (limpioContenido && limpioContenido.texto) {
      contexto.contenido = limpioContenido.texto
      if (limpioContenido.recortado) contexto.contenidoRecortado = true
      partes.push(this.parteTexto('contenido', 'Contenido', limpioContenido.texto, limpioContenido.caracteresOriginales, limpioContenido.recortado))
    } else if (avisos.length === 0) {
      avisos.push(
        ventana.restringida
          ? 'No puedo leer esa ventana: probablemente se ejecuta como administrador y Windows no me deja.'
          : 'Esa ventana no muestra texto que pueda leer.'
      )
    }

    const sugerirCaptura = !contenidoUtil(limpioContenido?.texto)
    if (sugerirCaptura && limpioContenido?.texto) avisos.push('Hay muy poco texto en esa ventana.')
    return { contexto, lectura: { partes, avisos, sugerirCaptura } }
  }

  private direccionDe(v: VentanaUia): ReturnType<typeof sanearUrl> {
    if (!v.esNavegador) return null
    return sanearUrl(v.url) ?? sanearUrl(normalizarBarra(v.barra))
  }

  private parteVentana(v: NonNullable<ContextoPantalla['ventana']>, parametrosOmitidos: boolean): ParteContexto {
    const titulo = vistaPrevia(v.titulo || '(sin título)', TITULO_RESUMEN_MAX)
    const vista = describirVentana(v) + (parametrosOmitidos ? '\n(Se han omitido los parámetros de la dirección.)' : '')
    return { clave: 'ventana', etiqueta: 'Ventana', resumen: `${v.aplicacion} — ${titulo}`, vista }
  }

  private parteTexto(
    clave: 'seleccion' | 'contenido',
    etiqueta: string,
    texto: string,
    caracteres: number,
    recortado: boolean
  ): ParteContexto {
    const miles = new Intl.NumberFormat('es-ES').format(caracteres)
    return {
      clave,
      etiqueta,
      resumen: `${miles} caracteres${recortado ? ' (recortado)' : ''}`,
      vista: vistaPrevia(texto, VISTA_MAX),
      caracteres,
      recortado
    }
  }

  private errorDelLector(e: unknown): ErrorChat {
    if (e instanceof ErrorChat) return e
    const detalle = e instanceof ErrorHelper ? e.message : e instanceof Error ? e.message : String(e)
    return new ErrorChat(crearError('lector_no_disponible', { detalle }))
  }
}
