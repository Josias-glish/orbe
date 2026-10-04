// Genera los iconos de Orbe (resources/icon.png, icon.ico y tray.png) sin dependencias: una esfera cian y violeta
// dibujada pixel a pixel y codificada con zlib. Se ejecuta con `npm run iconos` y los resultados se guardan en git.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'

const CARPETA = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')

const CIAN = [0x22, 0xd3, 0xee]
const VIOLETA = [0x8b, 0x5c, 0xf6]
const ANIL = [0x1e, 0x1b, 0x4b]
const MAGENTA = [0xe8, 0x79, 0xf9]

const mezclar = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const suave = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Color premultiplicado [r, g, b, a] (0–1) de un punto del lienzo, con coordenadas de -1 a 1. */
function muestra(x, y, radio, brillo) {
  const d = Math.hypot(x, y)
  if (d <= radio) {
    const nx = x / radio
    const ny = y / radio
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
    // Manchas fluidas: cian arriba a la izquierda, violeta abajo a la derecha, un toque magenta.
    const onda = 0.5 + 0.5 * Math.sin(3.2 * ny + 2.1 * nx + 1.3)
    let c = mezclar(VIOLETA, CIAN, suave(0.15, 0.85, 0.5 - 0.45 * nx + 0.38 * ny * -1 + 0.22 * onda))
    c = mezclar(c, MAGENTA, 0.35 * suave(0.55, 0.95, 0.5 + 0.5 * Math.sin(2.4 * nx - 3.1 * ny + 0.6)) * nz)
    c = mezclar(ANIL, c, 0.35 + 0.65 * Math.pow(nz, 0.6))
    // Borde de Fresnel y brillo especular.
    const fresnel = Math.pow(1 - nz, 2.6)
    c = mezclar(c, [210, 250, 255], 0.55 * fresnel)
    const especular = Math.exp(-(Math.hypot(nx + 0.32, ny + 0.38) ** 2) * 14)
    c = mezclar(c, [255, 255, 255], 0.7 * especular)
    return [c[0] / 255, c[1] / 255, c[2] / 255, 1]
  }
  // Resplandor exterior, solo en los iconos grandes.
  const a = brillo * Math.exp(-(d - radio) * 7)
  if (a < 0.004) return [0, 0, 0, 0]
  const c = mezclar(VIOLETA, CIAN, suave(-0.6, 0.6, -x + 0.3 * -y))
  return [(c[0] / 255) * a, (c[1] / 255) * a, (c[2] / 255) * a, a]
}

/** Píxeles RGBA de un icono cuadrado de `tam` px, con supersampling 4×4 para bordes suaves. */
function dibujar(tam, radio, brillo) {
  const SS = 4
  const datos = Buffer.alloc(tam * tam * 4)
  for (let py = 0; py < tam; py++) {
    for (let px = 0; px < tam; px++) {
      const suma = [0, 0, 0, 0]
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / tam) * 2 - 1
          const y = ((py + (sy + 0.5) / SS) / tam) * 2 - 1
          const m = muestra(x, y, radio, brillo)
          for (let i = 0; i < 4; i++) suma[i] += m[i]
        }
      }
      const n = SS * SS
      const alfa = suma[3] / n
      const o = (py * tam + px) * 4
      if (alfa > 0) {
        for (let i = 0; i < 3; i++) datos[o + i] = Math.round(Math.min(1, suma[i] / n / alfa) * 255)
        datos[o + 3] = Math.round(alfa * 255)
      }
    }
  }
  return datos
}

function chunk(tipo, datos) {
  const cabecera = Buffer.alloc(8)
  cabecera.writeUInt32BE(datos.length, 0)
  cabecera.write(tipo, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([cabecera.subarray(4), datos])) >>> 0, 0)
  return Buffer.concat([cabecera, datos, crc])
}

function codificarPng(tam, rgba) {
  const filas = Buffer.alloc((tam * 4 + 1) * tam)
  for (let y = 0; y < tam; y++) {
    filas[y * (tam * 4 + 1)] = 0 // filtro «ninguno»
    rgba.copy(filas, y * (tam * 4 + 1) + 1, y * tam * 4, (y + 1) * tam * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(tam, 0)
  ihdr.writeUInt32BE(tam, 4)
  ihdr[8] = 8 // 8 bits por canal
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filas, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** ICO con un PNG por tamaño (Windows Vista en adelante lo admite). 256 se escribe como 0. */
function codificarIco(imagenes) {
  const cabecera = Buffer.alloc(6)
  cabecera.writeUInt16LE(1, 2) // tipo: icono
  cabecera.writeUInt16LE(imagenes.length, 4)
  const entradas = []
  let desplazamiento = 6 + imagenes.length * 16
  for (const { tam, png } of imagenes) {
    const e = Buffer.alloc(16)
    e[0] = tam === 256 ? 0 : tam
    e[1] = tam === 256 ? 0 : tam
    e.writeUInt16LE(1, 4) // planos
    e.writeUInt16LE(32, 6) // bits por píxel
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(desplazamiento, 12)
    desplazamiento += png.length
    entradas.push(e)
  }
  return Buffer.concat([cabecera, ...entradas, ...imagenes.map((i) => i.png)])
}

mkdirSync(CARPETA, { recursive: true })

// Iconos de la aplicación: esfera con margen para un resplandor suave.
const tamanos = [16, 24, 32, 48, 64, 128, 256]
const imagenes = tamanos.map((tam) => ({ tam, png: codificarPng(tam, dibujar(tam, tam <= 32 ? 0.9 : 0.74, tam <= 32 ? 0 : 0.5)) }))
writeFileSync(join(CARPETA, 'icon.ico'), codificarIco(imagenes))
writeFileSync(join(CARPETA, 'icon.png'), imagenes.find((i) => i.tam === 256).png)

// Bandeja: 32 px (Windows lo reduce a 16 o lo usa tal cual con pantallas de alta densidad), sin resplandor.
writeFileSync(join(CARPETA, 'tray.png'), codificarPng(32, dibujar(32, 0.92, 0)))

console.log('Iconos generados en', CARPETA)
