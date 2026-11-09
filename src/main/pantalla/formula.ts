import type { OrigenTextoImagen } from '../../shared/tipos'
import { ErrorChat, crearError } from '../chat/errores'
import { AVISO_NEGRA, comprimirImagen, type CapturaHecha, type ImagenNativa } from './captura'
import type { DepsOcr } from './ocr'

/** Lo que el servicio necesita del sistema; en las pruebas se sustituye por uno de mentira. */
export interface DepsFormula {
  /** La misma forma de conseguir la imagen que el texto de imagen: ventana, portapapeles o archivo. `null` si se canceló. */
  obtener: DepsOcr['obtener']
  /** Abre la imagen ya obtenida; null si no se puede abrir (formato que la IA no admite). */
  cargar(ruta: string): Promise<ImagenNativa | null>
}

export const VISTA_FORMULA =
  'La IA verá esta imagen con tu próximo mensaje para reconocer la fórmula o la estructura química y resolverla. Solo viaja si envías.'

export const AVISO_FORMULA =
  'Para fórmulas y estructuras hace falta un modelo que vea imágenes (Claude, Gemini, GPT-4o…). Revisa que la transcripción coincide con la imagen.'

/**
 * Prepara una imagen con una fórmula matemática, una ecuación o una estructura química para que la IA la reconozca y
 * la resuelva. El texto plano del OCR no sirve aquí (fracciones, exponentes, integrales y enlaces químicos se pierden),
 * así que lo que viaja es la imagen, reducida, y solo si el usuario envía el mensaje. Tampoco es un pantallazo: la
 * imagen sale de la ventana que estabas usando (sin ocultar Orbe), del portapapeles o de un archivo.
 */
export class ServicioFormula {
  private enCurso: Promise<CapturaHecha | null> | null = null
  private origenEnCurso: OrigenTextoImagen | null = null

  constructor(private readonly deps: DepsFormula) {}

  leer(origen: OrigenTextoImagen): Promise<CapturaHecha | null> {
    if (this.enCurso && this.origenEnCurso !== origen) {
      return Promise.reject(new ErrorChat(crearError('ocr_no_disponible', { mensaje: 'Ya estoy preparando otra imagen. Espera a que termine.' })))
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

  private async hacer(origen: OrigenTextoImagen): Promise<CapturaHecha | null> {
    const obtenida = await this.deps.obtener(origen)
    if (!obtenida) return null
    let cruda: ImagenNativa | null
    try {
      cruda = await this.deps.cargar(obtenida.ruta)
    } finally {
      await obtenida.liberar().catch(() => undefined)
    }
    if (!cruda) {
      throw new ErrorChat(crearError('ocr_sin_imagen', { mensaje: 'No he podido abrir esa imagen. Para fórmulas usa PNG o JPG.' }))
    }
    const lista = comprimirImagen(cruda)
    const de = obtenida.descripcion ? ` · ${obtenida.descripcion.slice(0, 40)}` : ''
    return {
      imagen: { ...lista.imagen, proposito: 'formula' },
      parte: { clave: 'imagen', etiqueta: 'Fórmula', resumen: `${lista.resumen}${de}`, vista: VISTA_FORMULA, miniatura: lista.miniatura },
      avisos: cruda.esNegra() ? [AVISO_NEGRA, AVISO_FORMULA] : [AVISO_FORMULA]
    }
  }
}
