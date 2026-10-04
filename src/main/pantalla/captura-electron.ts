import { desktopCapturer, screen, type Display, type NativeImage } from 'electron'
import type { VentanaOrbe } from '../ventana'
import { dimensionesReducidas, esMuestraNegra, type DepsCaptura, type ImagenNativa } from './captura'
import type { VentanaUia } from './contexto'

/** Envuelve una `NativeImage` de Electron con las operaciones que usa el servicio de captura. */
export function envolverImagen(img: NativeImage): ImagenNativa {
  const tamano = (): { ancho: number; alto: number } => {
    const { width, height } = img.getSize()
    return { ancho: width, alto: height }
  }
  return {
    tamano,
    reducir(maxLado) {
      const { ancho, alto } = tamano()
      const d = dimensionesReducidas(ancho, alto, maxLado)
      if (d.ancho === ancho && d.alto === alto) return envolverImagen(img)
      return envolverImagen(img.resize({ width: d.ancho, height: d.alto, quality: 'best' }))
    },
    aJpeg: (calidad) => img.toJPEG(calidad),
    esNegra: () => esMuestraNegra(img.toBitmap())
  }
}

/** Una ventana minimizada de Windows se coloca en (-32000, -32000): no sirve para saber el monitor. */
const rectUtil = (r: VentanaUia['rect']): r is NonNullable<VentanaUia['rect']> => !!r && r.x > -30_000 && r.y > -30_000 && r.ancho > 0 && r.alto > 0

/**
 * La captura real con Electron: elige el monitor donde está la ventana que el usuario estaba usando (o, si no se
 * sabe, el de Orbe), oculta la ventana de Orbe y le pide a Windows la imagen de ese monitor.
 */
export function crearDepsReales(ventana: VentanaOrbe, ventanaObjetivo: () => Promise<VentanaUia | null>): DepsCaptura {
  return {
    async elegirPantalla(): Promise<Display> {
      try {
        // El lector puede tardar si Windows va justo; no merece la pena esperar más de un par de segundos.
        const objetivo = await Promise.race([
          ventanaObjetivo(),
          new Promise<null>((resolver) => setTimeout(() => resolver(null), 2500))
        ])
        const rect = objetivo?.rect
        if (rectUtil(rect)) {
          const dip = screen.screenToDipRect(null, { x: rect.x, y: rect.y, width: rect.ancho, height: rect.alto })
          return screen.getDisplayMatching(dip)
        }
      } catch {
        // se usa la pantalla de Orbe
      }
      return screen.getDisplayMatching(ventana.ventana.getBounds())
    },

    ocultar: () => ventana.ocultar(),

    restaurar: () => {
      ventana.mostrar()
      // Con el panel abierto se va a seguir escribiendo: vuelve con el foco.
      if (ventana.estaExpandido) ventana.enfocar()
    },

    esperar: (ms) => new Promise((resolver) => setTimeout(resolver, ms)),

    async tomar(destino): Promise<ImagenNativa | null> {
      const pantalla = destino as Display
      const fuentes = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(pantalla.size.width * pantalla.scaleFactor),
          height: Math.round(pantalla.size.height * pantalla.scaleFactor)
        }
      })
      const posicion = screen.getAllDisplays().findIndex((d) => d.id === pantalla.id)
      const fuente = fuentes.find((f) => f.display_id === String(pantalla.id)) ?? fuentes[Math.max(0, posicion)] ?? fuentes[0]
      if (!fuente || fuente.thumbnail.isEmpty()) return null
      return envolverImagen(fuente.thumbnail)
    }
  }
}
