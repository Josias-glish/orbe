import { nativeImage } from 'electron'
import type { ProcesarImagen } from './fondos'
import { dimensionesReducidas } from './pantalla/captura'

/** Lado mayor del fondo guardado: nítido hasta en un panel grande y mucho más ligero que un original de 4K. */
export const LADO_FONDO = 1600

/** Abre la imagen con Electron, la reduce y la devuelve en JPEG. Null si no se puede abrir. */
export const procesarConElectron: ProcesarImagen = async (ruta) => {
  const imagen = nativeImage.createFromPath(ruta)
  if (imagen.isEmpty()) return null
  const { width, height } = imagen.getSize()
  const d = dimensionesReducidas(width, height, LADO_FONDO)
  const reducida = d.ancho === width && d.alto === height ? imagen : imagen.resize({ width: d.ancho, height: d.alto, quality: 'best' })
  return reducida.toJPEG(80)
}
