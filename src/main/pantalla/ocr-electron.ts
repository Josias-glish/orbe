import { execFile } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { clipboard, desktopCapturer, dialog, nativeImage, type NativeImage } from 'electron'
import { ErrorChat, crearError } from '../chat/errores'
import type { VentanaOrbe } from '../ventana'
import type { VentanaUia } from './contexto'
import { dimensionesReducidas, type ImagenNativa } from './captura'
import { envolverImagen } from './captura-electron'
import { EXTENSIONES_OCR, LADO_MAX_OCR, MAX_BYTES_ARCHIVO, extensionAdmitida, interpretarSalidaOcr, type DepsOcr, type ImagenParaOcr } from './ocr'

const TIEMPO_OCR_MS = 45_000

/** Reduce si hace falta (el OCR de Windows tiene un máximo por lado) y nunca agranda. */
function ajustar(img: NativeImage): NativeImage {
  const { width, height } = img.getSize()
  const d = dimensionesReducidas(width, height, LADO_MAX_OCR)
  return d.ancho === width && d.alto === height ? img : img.resize({ width: d.ancho, height: d.alto, quality: 'best' })
}

/** Guarda la imagen como PNG en una carpeta temporal propia (solo para el OCR) y devuelve cómo borrarla. */
async function copiaTemporal(img: NativeImage, descripcion?: string): Promise<ImagenParaOcr> {
  const carpeta = await mkdtemp(join(tmpdir(), 'orbe-ocr-'))
  const ruta = join(carpeta, 'imagen.png')
  try {
    await writeFile(ruta, ajustar(img).toPNG(), { mode: 0o600 })
  } catch (e) {
    // Que no quede una carpeta a medias en %TEMP%.
    await rm(carpeta, { recursive: true, force: true }).catch(() => undefined)
    throw e
  }
  return {
    ruta,
    ...(descripcion ? { descripcion } : {}),
    liberar: () => rm(carpeta, { recursive: true, force: true })
  }
}

/** La primera imagen del portapapeles (API asíncrona de Electron), o null si no hay. Solo se lee al pulsar el botón. */
async function imagenDelPortapapeles(): Promise<NativeImage | null> {
  const elementos = await clipboard.read()
  for (const elemento of elementos) {
    const tipo = elemento.types.find((t) => t.startsWith('image/'))
    if (!tipo) continue
    const blob = (await elemento.getType(tipo)) as Blob
    const bytes = Buffer.from(await blob.arrayBuffer())
    const img = nativeImage.createFromBuffer(bytes)
    if (!img.isEmpty()) return img
  }
  return null
}

/**
 * Las fuentes reales: (1) la ventana que estabas usando, pedida a Windows directamente (no se fotografía el monitor
 * ni se oculta Orbe: Windows entrega el contenido de esa ventana aunque haya otras encima), (2) la imagen que haya en
 * el portapapeles y (3) un archivo que eliges tú. El reconocimiento lo hace `helper/ocr.ps1` con el OCR de Windows.
 */
export function crearDepsOcrReales(opciones: {
  ventana: VentanaOrbe
  ventanaObjetivo: () => Promise<VentanaUia | null>
  carpetaHelper: string
}): DepsOcr {
  return {
    async obtener(origen) {
      if (origen === 'portapapeles') {
        const img = await imagenDelPortapapeles()
        if (!img || img.isEmpty()) throw new ErrorChat(crearError('ocr_sin_imagen'))
        return copiaTemporal(img, 'portapapeles')
      }

      if (origen === 'archivo') {
        const r = await dialog.showOpenDialog(opciones.ventana.ventana, {
          title: 'Elige una imagen para leer su texto',
          properties: ['openFile'],
          filters: [{ name: 'Imágenes', extensions: [...EXTENSIONES_OCR] }]
        })
        const ruta = r.canceled ? undefined : r.filePaths[0]
        if (!ruta) return null
        if (!extensionAdmitida(ruta)) throw new ErrorChat(crearError('ocr_sin_imagen', { mensaje: 'Ese archivo no es una imagen que pueda leer (PNG, JPG, BMP, GIF o TIFF).' }))
        const info = await stat(ruta)
        if (info.size > MAX_BYTES_ARCHIVO) throw new ErrorChat(crearError('ocr_sin_imagen', { mensaje: 'Esa imagen pesa demasiado (más de 40 MB).' }))
        const img = nativeImage.createFromPath(ruta)
        // PNG y JPEG los abre Electron (y se reducen si son enormes); BMP, GIF y TIFF los abre directamente Windows.
        if (!img.isEmpty()) return copiaTemporal(img, basename(ruta))
        return { ruta, descripcion: basename(ruta), liberar: async () => undefined }
      }

      // La ventana que estabas usando, sin pantallazo del monitor.
      const objetivo = await opciones.ventanaObjetivo()
      if (!objetivo) throw new ErrorChat(crearError('sin_ventana'))
      const rect = objetivo.rect
      const ancho = rect && rect.ancho > 0 ? rect.ancho : 1920
      const alto = rect && rect.alto > 0 ? rect.alto : 1080
      const fuentes = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: Math.min(ancho, LADO_MAX_OCR), height: Math.min(alto, LADO_MAX_OCR) },
        fetchWindowIcons: false
      })
      const fuente = fuentes.find((f) => f.id.startsWith(`window:${objetivo.hwnd}:`))
      if (!fuente || fuente.thumbnail.isEmpty()) {
        throw new ErrorChat(
          crearError('ocr_sin_imagen', { mensaje: 'Windows no me ha dado la imagen de esa ventana (¿está minimizada?). Prueba con el portapapeles o un archivo.' })
        )
      }
      return copiaTemporal(fuente.thumbnail, objetivo.aplicacion)
    },

    reconocer(ruta) {
      const ps = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      const script = join(opciones.carpetaHelper, 'ocr.ps1')
      return new Promise((resolver, rechazar) => {
        execFile(
          ps,
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Ruta', ruta],
          { timeout: TIEMPO_OCR_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
          (error, stdout) => {
            try {
              resolver(interpretarSalidaOcr(stdout ?? ''))
            } catch (e) {
              if (error && !(stdout ?? '').trim()) {
                rechazar(new ErrorChat(crearError('ocr_no_disponible', { detalle: error.message })))
              } else rechazar(e)
            }
          }
        )
      })
    }
  }
}

/** Abre una imagen ya obtenida para enviarla a la IA (fórmulas): PNG y JPEG; null si Electron no sabe abrirla. */
export async function cargarImagenElectron(ruta: string): Promise<ImagenNativa | null> {
  const img = nativeImage.createFromPath(ruta)
  return img.isEmpty() ? null : envolverImagen(img)
}
