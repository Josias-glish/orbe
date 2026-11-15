import { desktopCapturer, screen } from 'electron'
import { dimensionesReducidas } from '../pantalla/captura'
import type { CapturaPc, RectPc } from './control'

const MAX_LADO = 1280

/**
 * Captura la zona de una ventana (en las unidades del helper) en memoria, en JPEG reducido: nunca se guarda en disco.
 * No toca la ventana de Orbe: cambiarle la protección de contenido sobre la marcha la dejaba sin dibujar.
 */
export function crearCapturaVentana(): (r: RectPc) => Promise<CapturaPc> {
  return async (r) => {
    // Unidades del helper: píxeles físicos en Windows; puntos en macOS (k = píxeles de la imagen por unidad).
    const mac = process.platform === 'darwin'
    const rect = { x: r.x, y: r.y, width: r.ancho, height: r.alto }
    const pantalla = screen.getDisplayMatching(mac ? rect : screen.screenToDipRect(null, rect))
    const zona = mac ? pantalla.bounds : screen.dipToScreenRect(null, pantalla.bounds)
    const k = mac ? pantalla.scaleFactor : 1
    const fuentes = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(zona.width * k), height: Math.round(zona.height * k) } })
    const fuente = fuentes.find((f) => f.display_id === String(pantalla.id)) ?? fuentes[0]
    if (!fuente || fuente.thumbnail.isEmpty()) {
      throw new Error(mac ? 'macOS no dio la imagen de la pantalla (¿falta el permiso de Grabación de pantalla para Orbe?).' : 'Windows no dio la imagen de la pantalla.')
    }
    const x = Math.max(0, r.x - zona.x)
    const y = Math.max(0, r.y - zona.y)
    const recorte = fuente.thumbnail.crop({
      x: Math.round(x * k), y: Math.round(y * k),
      width: Math.round(Math.min(r.ancho, zona.width - x) * k), height: Math.round(Math.min(r.alto, zona.height - y) * k)
    })
    const t = recorte.getSize()
    const d = dimensionesReducidas(t.width, t.height, MAX_LADO)
    const img = d.ancho === t.width ? recorte : recorte.resize({ width: d.ancho, height: d.alto, quality: 'best' })
    return { jpeg: img.toJPEG(80).toString('base64'), ancho: d.ancho, alto: d.alto, origen: { x: zona.x + x, y: zona.y + y }, escala: t.width / d.ancho / k }
  }
}
