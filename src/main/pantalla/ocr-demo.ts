import type { OrigenTextoImagen } from '../../shared/tipos'
import { nativeImage } from 'electron'
import type { ImagenNativa } from './captura'
import { envolverImagen } from './captura-electron'
import type { DepsOcr, ImagenParaOcr, TextoReconocido } from './ocr'

/** Texto de mentira que «aparece» en la imagen de la prueba de humo. */
export const TEXTO_OCR_DEMO = 'OFERTA DE OTOÑO\nTodo al 30 % hasta el domingo\nCódigo: ORBE30'

/**
 * OCR de mentira para la prueba de humo (--smoke): no lee la ventana real, ni el portapapeles, ni abre diálogos,
 * ni lanza PowerShell. Devuelve siempre el mismo texto, salvo que se le pida fallar o no encontrar nada.
 */
export class OcrDemo implements DepsOcr {
  falla = false
  sinTexto = false
  pedidos: OrigenTextoImagen[] = []
  liberadas = 0

  async obtener(origen: OrigenTextoImagen): Promise<ImagenParaOcr | null> {
    this.pedidos.push(origen)
    return { ruta: 'demo.png', descripcion: origen === 'archivo' ? 'oferta.png' : 'Demo', liberar: async () => void this.liberadas++ }
  }

  async reconocer(): Promise<TextoReconocido> {
    if (this.falla) throw new Error('El OCR de prueba falló a propósito.')
    return { texto: this.sinTexto ? '   ' : TEXTO_OCR_DEMO, idioma: 'es-ES' }
  }

  /** Imagen de mentira para las fórmulas: un degradado pequeño (nunca una imagen real del usuario). */
  async cargar(): Promise<ImagenNativa | null> {
    const ancho = 640
    const alto = 200
    const bitmap = Buffer.alloc(ancho * alto * 4)
    for (let i = 0; i < ancho * alto; i++) {
      bitmap[i * 4] = 240
      bitmap[i * 4 + 1] = 235 - Math.round((i % ancho) / 8)
      bitmap[i * 4 + 2] = 230
      bitmap[i * 4 + 3] = 255
    }
    return envolverImagen(nativeImage.createFromBitmap(bitmap, { width: ancho, height: alto }))
  }
}
