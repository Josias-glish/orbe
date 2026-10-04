import { nativeImage } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProcesarImagen } from './fondos'

/** Carpeta con «imágenes» de mentira (vacías) para la prueba visual: nunca se tocan las del usuario. */
export function prepararFondosDeMentira(base: string): string {
  const carpeta = join(base, 'orbe-humo-fondos')
  rmSync(carpeta, { recursive: true, force: true })
  mkdirSync(carpeta, { recursive: true })
  for (const n of ['fondo-demo-1.png', 'fondo-demo-2.png', 'fondo-demo-3.jpg']) writeFileSync(join(carpeta, n), 'no es una imagen real')
  writeFileSync(join(carpeta, 'notas.txt'), 'esto no es una imagen')
  return carpeta
}

/** Genera un degradado distinto según el nombre del archivo, en vez de abrirlo. */
export const procesarDeMentira: ProcesarImagen = async (ruta) => {
  const ancho = 800
  const alto = 1000
  const semilla = [...ruta].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 360, 7)
  const bitmap = Buffer.alloc(ancho * alto * 4)
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = (y * ancho + x) * 4
      const t = (x / ancho + y / alto) / 2
      bitmap[i] = Math.round(70 + 150 * ((semilla / 360 + t) % 1)) // B
      bitmap[i + 1] = Math.round(60 + 120 * (1 - t)) // G
      bitmap[i + 2] = Math.round(80 + 140 * ((semilla / 180 + t * 0.5) % 1)) // R
      bitmap[i + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width: ancho, height: alto }).toJPEG(80)
}
