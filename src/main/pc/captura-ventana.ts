import { desktopCapturer, screen } from 'electron'
import { dimensionesReducidas } from '../pantalla/captura'
import type { CapturaPc, RectPc } from './control'

const MAX_LADO = 1280

/**
 * Captura la zona de una ventana (píxeles físicos de pantalla) en memoria, en JPEG reducido: nunca se guarda en disco.
 * No toca la ventana de Orbe: cambiarle la protección de contenido sobre la marcha la dejaba sin dibujar.
 */
export function crearCapturaVentana(): (r: RectPc) => Promise<CapturaPc> {
  return async (r) => {
    const dip = screen.screenToDipRect(null, { x: r.x, y: r.y, width: r.ancho, height: r.alto })
    const pantalla = screen.getDisplayMatching(dip)
    const fisica = screen.dipToScreenRect(null, pantalla.bounds)
    {
      const fuentes = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: fisica.width, height: fisica.height } })
      const fuente = fuentes.find((f) => f.display_id === String(pantalla.id)) ?? fuentes[0]
      if (!fuente || fuente.thumbnail.isEmpty()) throw new Error('Windows no dio la imagen de la pantalla.')
      const x = Math.max(0, r.x - fisica.x)
      const y = Math.max(0, r.y - fisica.y)
      const recorte = fuente.thumbnail.crop({ x, y, width: Math.min(r.ancho, fisica.width - x), height: Math.min(r.alto, fisica.height - y) })
      const t = recorte.getSize()
      const d = dimensionesReducidas(t.width, t.height, MAX_LADO)
      const img = d.ancho === t.width ? recorte : recorte.resize({ width: d.ancho, height: d.alto, quality: 'best' })
      return { jpeg: img.toJPEG(80).toString('base64'), ancho: d.ancho, alto: d.alto, origen: { x: fisica.x + x, y: fisica.y + y }, escala: t.width / d.ancho }
    }
  }
}
