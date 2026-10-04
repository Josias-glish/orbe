import { nativeImage } from 'electron'
import type { DepsCaptura, ImagenNativa } from './captura'
import { envolverImagen } from './captura-electron'

/**
 * Captura de mentira para las pruebas visuales (--smoke): nunca fotografía la pantalla real del usuario ni oculta
 * la ventana. Genera una imagen de degradado con una cuadrícula para que la vista previa se vea.
 */
export class CapturaDemo implements DepsCaptura {
  /** Hace que la siguiente captura falle, para probar el mensaje de error. */
  falla = false
  ocultadas = 0
  restauradas = 0

  async elegirPantalla(): Promise<unknown> {
    return undefined
  }
  ocultar(): void {
    this.ocultadas++
  }
  restaurar(): void {
    this.restauradas++
  }
  esperar(): Promise<void> {
    return Promise.resolve()
  }

  async tomar(): Promise<ImagenNativa | null> {
    if (this.falla) throw new Error('La captura de prueba falló a propósito.')
    const ancho = 1920
    const alto = 1080
    const bitmap = Buffer.alloc(ancho * alto * 4)
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const i = (y * ancho + x) * 4
        const rejilla = x % 120 < 2 || y % 120 < 2
        // BGRA: del cian al violeta en diagonal.
        const t = (x / ancho + y / alto) / 2
        bitmap[i] = rejilla ? 255 : Math.round(120 + 120 * t) // B
        bitmap[i + 1] = rejilla ? 255 : Math.round(210 - 120 * t) // G
        bitmap[i + 2] = rejilla ? 255 : Math.round(60 + 110 * t) // R
        bitmap[i + 3] = 255
      }
    }
    return envolverImagen(nativeImage.createFromBitmap(bitmap, { width: ancho, height: alto }))
  }
}
