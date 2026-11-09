import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  CANALES,
  type ClaveParte,
  type EventoPantalla,
  type LecturaPantalla,
  type OrigenTextoImagen,
  type RespuestaLectura
} from '../../shared/tipos'
import { aErrorOrbe, crearError } from '../chat/errores'
import type { VentanaOrbe } from '../ventana'
import type { ServicioCaptura } from './captura'
import { ServicioPantalla, type FuenteUia } from './contexto'
import type { ServicioFormula } from './formula'
import type { ServicioTextoImagen } from './ocr'
import { ContextoPendiente } from './pendiente'

const CLAVES: readonly string[] = ['ventana', 'seleccion', 'contenido', 'imagen', 'texto_imagen']
const ORIGENES: readonly string[] = ['ventana', 'portapapeles', 'archivo']
const esOrigen = (v: unknown): v is OrigenTextoImagen => typeof v === 'string' && ORIGENES.includes(v)
const esClave = (v: unknown): v is ClaveParte => typeof v === 'string' && CLAVES.includes(v)

export interface PantallaRegistrada {
  servicio: ServicioPantalla
  pendiente: ContextoPendiente
  emitir: (evento: EventoPantalla) => void
  /** Atajo «leer pantalla»: lee la ventana en la que estás, abre el panel y deja el contexto listo. */
  leerConAtajo: () => Promise<void>
}

/**
 * Conecta el lector de pantalla con la interfaz. La pantalla solo se lee cuando el usuario lo pide:
 * con el botón del panel o con el atajo. Nada se envía al modelo hasta que él manda su mensaje.
 */
export function registrarPantalla(opciones: {
  ventana: VentanaOrbe
  fuente: FuenteUia
  contextoMax: number
  /** Captura de respaldo; sin ella el botón de la cámara devuelve un error. */
  captura?: ServicioCaptura
  /** Texto de una imagen (OCR en el equipo); sin él, el botón devuelve un error. */
  textoImagen?: ServicioTextoImagen
  /** Fórmulas y estructuras químicas (la IA ve la imagen); sin él, el botón devuelve un error. */
  formula?: ServicioFormula
}): PantallaRegistrada {
  const { ventana } = opciones
  const emitir = (evento: EventoPantalla): void => {
    const w = ventana.ventana
    if (!w.isDestroyed()) w.webContents.send(CANALES.pantallaEvento, evento)
  }
  const pendiente = new ContextoPendiente(() => emitir({ tipo: 'vacio', motivo: 'caducado' }))
  const servicio = new ServicioPantalla(opciones.fuente, { contextoMax: opciones.contextoMax })
  const propia = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => e.sender === ventana.ventana.webContents

  ipcMain.handle(CANALES.pantallaLeer, async (e): Promise<RespuestaLectura> => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    try {
      const lectura = pendiente.establecer(await servicio.leer())
      return { ok: true, ...lectura }
    } catch (error) {
      return { ok: false, error: aErrorOrbe(error) }
    }
  })

  // La interfaz ya ha pedido confirmación al usuario; aquí solo se acepta de la ventana de Orbe. La imagen entera
  // se queda en este proceso: a la interfaz solo vuelve el chip con una miniatura.
  ipcMain.handle(CANALES.pantallaCapturar, async (e): Promise<RespuestaLectura> => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    if (!opciones.captura) return { ok: false, error: crearError('captura_no_disponible') }
    try {
      const hecha = await opciones.captura.capturar()
      return { ok: true, ...pendiente.agregarImagen(hecha) }
    } catch (error) {
      return { ok: false, error: aErrorOrbe(error) }
    }
  })

  // Sin pantallazo del monitor ni confirmación de captura: la imagen no sale del equipo, solo su texto, y solo si el
  // usuario envía el mensaje. Igual que el ojo, el usuario lo pide con un botón; nunca ocurre por su cuenta.
  ipcMain.handle(CANALES.pantallaTextoImagen, async (e, origen: unknown): Promise<RespuestaLectura> => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    if (!esOrigen(origen)) return { ok: false, error: crearError('ocr_sin_imagen') }
    if (!opciones.textoImagen) return { ok: false, error: crearError('ocr_no_disponible') }
    try {
      const hecho = await opciones.textoImagen.leer(origen)
      // Canceló (cerró el diálogo de archivo): se queda como estaba.
      if (!hecho) {
        const actual = pendiente.lectura()
        return { ok: true, ...(actual ?? { partes: [], avisos: [], sugerirCaptura: false }) }
      }
      return { ok: true, ...pendiente.agregarTextoImagen(hecho) }
    } catch (error) {
      return { ok: false, error: aErrorOrbe(error) }
    }
  })

  // Fórmulas y química: aquí sí viaja la imagen (el OCR de texto plano pierde fracciones, exponentes y enlaces), así
  // que el chip enseña la miniatura antes de enviar. El usuario elige la imagen; nunca es un pantallazo del monitor.
  ipcMain.handle(CANALES.pantallaFormula, async (e, origen: unknown): Promise<RespuestaLectura> => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    if (!esOrigen(origen)) return { ok: false, error: crearError('ocr_sin_imagen') }
    if (!opciones.formula) return { ok: false, error: crearError('ocr_no_disponible') }
    try {
      const hecha = await opciones.formula.leer(origen)
      if (!hecha) {
        const actual = pendiente.lectura()
        return { ok: true, ...(actual ?? { partes: [], avisos: [], sugerirCaptura: false }) }
      }
      return { ok: true, ...pendiente.agregarImagen(hecha) }
    } catch (error) {
      return { ok: false, error: aErrorOrbe(error) }
    }
  })

  ipcMain.handle(CANALES.pantallaQuitar, (e, clave: unknown): LecturaPantalla | null => {
    if (!propia(e) || !esClave(clave)) return null
    return pendiente.quitar(clave)
  })

  ipcMain.on(CANALES.pantallaDescartar, (e) => {
    if (propia(e)) pendiente.descartar()
  })

  const leerConAtajo = async (): Promise<void> => {
    emitir({ tipo: 'leyendo', activo: true })
    try {
      // Se lee ANTES de abrir el panel: así la ventana del usuario aún tiene el foco y se ve su selección.
      const lectura = pendiente.establecer(await servicio.leer())
      ventana.mostrar()
      ventana.establecerExpandido(true)
      emitir({ tipo: 'pendiente', lectura, origen: 'atajo' })
    } catch (error) {
      ventana.mostrar()
      ventana.establecerExpandido(true)
      emitir({ tipo: 'error', error: aErrorOrbe(error) })
    } finally {
      emitir({ tipo: 'leyendo', activo: false })
    }
  }

  return { servicio, pendiente, emitir, leerConAtajo }
}
