import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  CANALES,
  type ClaveParte,
  type EventoPantalla,
  type LecturaPantalla,
  type RespuestaLectura
} from '../../shared/tipos'
import { aErrorOrbe, crearError } from '../chat/errores'
import type { VentanaOrbe } from '../ventana'
import type { ServicioCaptura } from './captura'
import { ServicioPantalla, type FuenteUia } from './contexto'
import { ContextoPendiente } from './pendiente'

const CLAVES: readonly string[] = ['ventana', 'seleccion', 'contenido', 'imagen']
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
