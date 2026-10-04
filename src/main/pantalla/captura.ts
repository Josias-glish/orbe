import type { ContextoPantalla, ParteContexto } from '../../shared/tipos'
import { ErrorChat, crearError } from '../chat/errores'

/** Lado mayor de la imagen que se envía: lo bastante grande para leer texto y lo bastante pequeño para ser rápida. */
export const LADO_MAX = 1500
export const CALIDAD_JPEG = 85
/** La API admite 5 MB por imagen en base64; con 3,5 MB de JPEG hay margen de sobra. */
export const MAX_BYTES_JPEG = 3_500_000
export const LADO_MINIATURA = 360
/** Tiempo para que Windows repinte el escritorio tras ocultar la ventana de Orbe, antes de capturar. */
export const RETRASO_OCULTAR_MS = 180

/** Una imagen capturada y las pocas operaciones que hacen falta (en Electron las da `NativeImage`). */
export interface ImagenNativa {
  tamano(): { ancho: number; alto: number }
  /** Reduce para que el lado mayor mida como mucho `maxLado`. Nunca agranda. */
  reducir(maxLado: number): ImagenNativa
  aJpeg(calidad: number): Uint8Array
  /** ¿Salió prácticamente negra? (contenido protegido, monitor apagado…). */
  esNegra(): boolean
}

/** Lo que el servicio necesita del sistema; en las pruebas se sustituye por uno de mentira. */
export interface DepsCaptura {
  /** Decide qué pantalla fotografiar (la de la ventana que el usuario estaba usando). El resultado es opaco para el servicio. */
  elegirPantalla(): Promise<unknown>
  ocultar(): void
  restaurar(): void
  esperar(ms: number): Promise<void>
  tomar(destino: unknown): Promise<ImagenNativa | null>
}

/** Lo que sale de una captura: la imagen para el modelo y el chip con su miniatura para el usuario. */
export interface CapturaHecha {
  imagen: NonNullable<ContextoPantalla['imagen']>
  parte: ParteContexto
  avisos: string[]
}

export const AVISO_NEGRA =
  'La captura ha salido casi negra (¿contenido protegido o un monitor apagado?). Mira la vista previa antes de enviarla.'

/** Medidas tras reducir para que el lado mayor no pase de `maxLado`, conservando la proporción. No agranda. */
export function dimensionesReducidas(ancho: number, alto: number, maxLado: number): { ancho: number; alto: number } {
  const mayor = Math.max(ancho, alto)
  if (mayor <= maxLado) return { ancho, alto }
  const escala = maxLado / mayor
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) }
}

/**
 * Mira una muestra de píxeles (BGRA o RGBA, da igual) y dice si la imagen es casi negra. Una captura de
 * contenido protegido (DRM) o de un monitor apagado sale negra y no serviría de nada enviarla.
 */
export function esMuestraNegra(pixeles: ArrayLike<number>, bytesPorPixel = 4, paso = 997): boolean {
  let suma = 0
  let maximo = 0
  let muestras = 0
  for (let i = 0; i + 2 < pixeles.length; i += bytesPorPixel * paso) {
    const brillo = (pixeles[i] + pixeles[i + 1] + pixeles[i + 2]) / 3
    suma += brillo
    if (brillo > maximo) maximo = brillo
    muestras++
  }
  return muestras > 0 && suma / muestras < 6 && maximo < 24
}

const aBase64 = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')

/**
 * Hace la captura de respaldo: oculta Orbe para que no salga en la foto, espera a que Windows repinte,
 * fotografía el monitor elegido, devuelve Orbe a su sitio (pase lo que pase) y deja la imagen reducida a
 * ~1500 px en JPEG, más una miniatura para la vista previa. No guarda nada en disco.
 */
export class ServicioCaptura {
  private enCurso: Promise<CapturaHecha> | null = null

  constructor(private readonly deps: DepsCaptura) {}

  /** Dos peticiones a la vez (doble clic) comparten la misma captura. */
  capturar(): Promise<CapturaHecha> {
    if (!this.enCurso) {
      this.enCurso = this.hacer().finally(() => {
        this.enCurso = null
      })
    }
    return this.enCurso
  }

  private async hacer(): Promise<CapturaHecha> {
    let destino: unknown
    try {
      destino = await this.deps.elegirPantalla()
    } catch {
      destino = undefined // sin saber cuál, se usa la pantalla por defecto del adaptador
    }

    let cruda: ImagenNativa | null
    this.deps.ocultar()
    try {
      await this.deps.esperar(RETRASO_OCULTAR_MS)
      cruda = await this.deps.tomar(destino)
    } catch (e) {
      throw new ErrorChat(crearError('captura_no_disponible', { detalle: e instanceof Error ? e.message : String(e) }))
    } finally {
      this.deps.restaurar()
    }
    if (!cruda) {
      throw new ErrorChat(crearError('captura_no_disponible', { detalle: 'Windows no devolvió ninguna imagen de la pantalla.' }))
    }

    // Primero con la calidad normal; si pesa demasiado, se baja la calidad y luego el tamaño.
    let reducida = cruda.reducir(LADO_MAX)
    let jpeg = reducida.aJpeg(CALIDAD_JPEG)
    for (const [lado, calidad] of [[LADO_MAX, 70], [1200, 70], [1000, 60]] as const) {
      if (jpeg.length <= MAX_BYTES_JPEG) break
      reducida = cruda.reducir(lado)
      jpeg = reducida.aJpeg(calidad)
    }
    if (jpeg.length > MAX_BYTES_JPEG) {
      throw new ErrorChat(crearError('captura_no_disponible', { detalle: 'La imagen pesa demasiado incluso reducida.' }))
    }

    const { ancho, alto } = reducida.tamano()
    const miniatura = `data:image/jpeg;base64,${aBase64(reducida.reducir(LADO_MINIATURA).aJpeg(70))}`
    const kb = Math.max(1, Math.round(jpeg.length / 1024))
    return {
      imagen: { tipoMime: 'image/jpeg', base64: aBase64(jpeg), ancho, alto },
      parte: {
        clave: 'imagen',
        etiqueta: 'Captura',
        resumen: `${ancho}×${alto} · ${new Intl.NumberFormat('es-ES').format(kb)} KB`,
        vista: 'Esta captura de tu pantalla viajará con tu próximo mensaje si lo envías.',
        miniatura
      },
      avisos: cruda.esNegra() ? [AVISO_NEGRA] : []
    }
  }
}
