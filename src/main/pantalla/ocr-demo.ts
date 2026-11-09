import type { OrigenTextoImagen } from '../../shared/tipos'
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
}
