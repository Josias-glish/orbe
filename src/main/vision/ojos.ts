import { desktopCapturer } from 'electron'
import type { VentanaUia } from '../pantalla/contexto'

/** Lado máximo de la imagen para la pantalla (VISION-Y-DATOS.md §2: 768 px para el Compañero). */
export const LADO_PANTALLA = 768

/** Ventanas que los ojos no miran nunca (A.3): bancos, pagos, contraseñas, ventanas privadas y la propia Orbe. */
const NUNCA =
  /banco|bank|bancolombia|davivienda|nequi|daviplata|bbva|paypal|mercado ?pago|tarjeta|bitwarden|1password|keepass|lastpass|dashlane|contraseña|password|inprivate|incógnito|incognito|privad[ao]/i

export function ventanaPermitida(v: Pick<VentanaUia, 'proceso' | 'titulo' | 'url' | 'aplicacion' | 'pid' | 'restringida'>, pidOrbe = process.pid): boolean {
  if (v.pid === pidOrbe || /^orbe$/i.test(v.aplicacion) || v.restringida) return false
  return !NUNCA.test([v.proceso, v.titulo, v.url ?? '', v.aplicacion].join(' '))
}

/** Una imagen casi negra (vídeo con DRM, ventana minimizada): no se envía. */
export function casiNegra(bgra: Buffer): boolean {
  let suma = 0
  let n = 0
  for (let i = 0; i < bgra.length; i += 4 * 97) {
    suma += bgra[i]! + bgra[i + 1]! + bgra[i + 2]!
    n++
  }
  return n === 0 || suma / (n * 3) < 10
}

/**
 * Captura silenciosa de UNA ventana (la que el usuario usa), sin ocultar ni mover nada, sin destello y sin tocar el
 * foco: Windows da la imagen de esa ventana, no de la pantalla, así que Orbe no sale. Reducida a 768 px y vuelta a
 * codificar como JPEG desde los píxeles (sin EXIF ni metadatos). Solo en memoria: nunca se escribe en disco.
 */
export async function capturarVentana(v: VentanaUia): Promise<Buffer | null> {
  if (!ventanaPermitida(v)) return null
  const fuentes = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: LADO_PANTALLA, height: LADO_PANTALLA }, fetchWindowIcons: false })
  const fuente = fuentes.find((f) => f.id.startsWith(`window:${v.hwnd}:`))
  const img = fuente?.thumbnail
  if (!img || img.isEmpty() || casiNegra(img.toBitmap())) return null
  return img.toJPEG(85)
}
