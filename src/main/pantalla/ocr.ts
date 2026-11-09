import type { OrigenTextoImagen, ParteContexto } from '../../shared/tipos'
import { ErrorChat, crearError } from '../chat/errores'
import { limpiarTexto, vistaPrevia } from './limpieza'

/** Vista previa del chip (lo que se envía entero va en el contexto, recortado a `contextoMax`). */
export const VISTA_OCR_MAX = 1200
/** Lado mayor de la imagen que se le pasa al OCR: más que suficiente para leer letra pequeña y por debajo del límite de Windows. */
export const LADO_MAX_OCR = 4000
/** Un archivo más grande que esto no es una imagen razonable para leer texto. */
export const MAX_BYTES_ARCHIVO = 40 * 1024 * 1024
export const EXTENSIONES_OCR = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tif', 'tiff'] as const

export const NOMBRES_ORIGEN: Record<OrigenTextoImagen, string> = {
  ventana: 'la ventana',
  portapapeles: 'el portapapeles',
  archivo: 'un archivo'
}

/** Una imagen lista para reconocer: un archivo en disco y cómo deshacerse de él (si es una copia temporal). */
export interface ImagenParaOcr {
  ruta: string
  /** Para el resumen del chip: «Microsoft Edge», «captura.png»… */
  descripcion?: string
  /** Borra la copia temporal (si la hay). Se llama siempre, salga bien o mal. */
  liberar(): Promise<void>
}

export interface TextoReconocido {
  texto: string
  /** Idioma con el que reconoció Windows (p. ej. «es-ES»). */
  idioma?: string
}

/** Lo que el servicio necesita del sistema; en las pruebas se sustituye por uno de mentira. */
export interface DepsOcr {
  /** Consigue la imagen. `null` si el usuario canceló (p. ej., cerró el diálogo de archivo sin elegir). */
  obtener(origen: OrigenTextoImagen): Promise<ImagenParaOcr | null>
  reconocer(ruta: string): Promise<TextoReconocido>
}

export interface TextoImagenHecho {
  texto: string
  recortado: boolean
  origen: OrigenTextoImagen
  parte: ParteContexto
  avisos: string[]
}

export const AVISO_OCR =
  'Texto reconocido automáticamente: puede tener errores en letra pequeña, a mano o muy decorada.'

/**
 * Saca el texto de una imagen sin hacer un pantallazo del monitor: la imagen sale de la propia ventana (que Windows
 * entrega aunque Orbe esté encima, así que Orbe no se oculta), del portapapeles o de un archivo, y el reconocimiento lo
 * hace Windows en el propio equipo. Al modelo solo le llega el texto, así que sirve también con modelos sin visión.
 * La imagen nunca llega a la interfaz ni se guarda: si hace falta una copia temporal, se borra al terminar.
 */
export class ServicioTextoImagen {
  private enCurso: Promise<TextoImagenHecho | null> | null = null
  private origenEnCurso: OrigenTextoImagen | null = null

  constructor(
    private readonly deps: DepsOcr,
    private readonly opciones: { contextoMax: number }
  ) {}

  /** Dos peticiones a la vez (doble clic) comparten el mismo reconocimiento. `null` si el usuario canceló. */
  leer(origen: OrigenTextoImagen): Promise<TextoImagenHecho | null> {
    if (this.enCurso && this.origenEnCurso !== origen) {
      // Otra fuente a la vez: no se le da el resultado de la primera con la etiqueta equivocada.
      return Promise.reject(new ErrorChat(crearError('ocr_no_disponible', { mensaje: 'Ya estoy leyendo otra imagen. Espera a que termine.' })))
    }
    if (!this.enCurso) {
      this.origenEnCurso = origen
      this.enCurso = this.hacer(origen).finally(() => {
        this.enCurso = null
        this.origenEnCurso = null
      })
    }
    return this.enCurso
  }

  private async hacer(origen: OrigenTextoImagen): Promise<TextoImagenHecho | null> {
    const imagen = await this.deps.obtener(origen)
    if (!imagen) return null

    let reconocido: TextoReconocido
    try {
      reconocido = await this.deps.reconocer(imagen.ruta)
    } catch (e) {
      if (e instanceof ErrorChat) throw e
      throw new ErrorChat(crearError('ocr_no_disponible', { detalle: e instanceof Error ? e.message : String(e) }))
    } finally {
      await imagen.liberar().catch(() => undefined)
    }

    const limpio = limpiarTexto(reconocido.texto ?? '', this.opciones.contextoMax)
    if (!limpio.texto) throw new ErrorChat(crearError('ocr_sin_texto'))

    const miles = new Intl.NumberFormat('es-ES').format(limpio.caracteresOriginales)
    const de = imagen.descripcion ? ` · ${vistaPrevia(imagen.descripcion, 40)}` : ''
    return {
      texto: limpio.texto,
      recortado: limpio.recortado,
      origen,
      parte: {
        clave: 'texto_imagen',
        etiqueta: 'Texto de imagen',
        resumen: `${miles} caracteres${limpio.recortado ? ' (recortado)' : ''}${de}`,
        vista: vistaPrevia(limpio.texto, VISTA_OCR_MAX),
        caracteres: limpio.caracteresOriginales,
        recortado: limpio.recortado
      },
      avisos: [AVISO_OCR]
    }
  }
}

/** ¿Tiene el archivo una extensión de imagen que el OCR sepa abrir? */
export function extensionAdmitida(ruta: string): boolean {
  const ext = /\.([a-z0-9]+)$/i.exec(ruta)?.[1]?.toLowerCase()
  return !!ext && (EXTENSIONES_OCR as readonly string[]).includes(ext)
}

/** Interpreta la última línea JSON que escribe `helper/ocr.ps1`. */
export function interpretarSalidaOcr(salida: string): TextoReconocido {
  const lineas = salida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (let i = lineas.length - 1; i >= 0; i--) {
    let datos: unknown
    try {
      datos = JSON.parse(lineas[i])
    } catch {
      continue
    }
    if (!datos || typeof datos !== 'object') continue
    const d = datos as { ok?: unknown; texto?: unknown; idioma?: unknown; error?: unknown; codigo?: unknown }
    if (d.ok === true) {
      return { texto: typeof d.texto === 'string' ? d.texto : '', ...(typeof d.idioma === 'string' ? { idioma: d.idioma } : {}) }
    }
    const detalle = typeof d.error === 'string' ? d.error : 'El reconocimiento de texto ha fallado.'
    throw new ErrorChat(crearError('ocr_no_disponible', { detalle }))
  }
  throw new ErrorChat(crearError('ocr_no_disponible', { detalle: 'El reconocimiento de texto no ha devuelto nada.' }))
}
