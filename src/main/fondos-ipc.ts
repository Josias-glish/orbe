import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { CANALES, type EstadoFondo } from '../shared/tipos'
import type { ServicioFondos } from './fondos'

/** Conecta el menú de fondos del panel con el servicio. La interfaz solo puede pedir cambiar de imagen o ajustarla. */
export function registrarFondos(ventana: BrowserWindow, servicio: ServicioFondos): void {
  const exigir = (e: IpcMainInvokeEvent): void => {
    if (e.sender !== ventana.webContents) throw new Error('Remitente no autorizado')
  }

  ipcMain.handle(CANALES.fondoEstado, async (e): Promise<EstadoFondo> => {
    exigir(e)
    return servicio.estado()
  })

  ipcMain.handle(CANALES.fondoSiguiente, async (e): Promise<EstadoFondo> => {
    exigir(e)
    return servicio.siguiente()
  })

  // La ruta la elige el usuario en el diálogo del sistema; la interfaz nunca manda una ruta.
  ipcMain.handle(CANALES.fondoElegir, async (e): Promise<EstadoFondo> => {
    exigir(e)
    const r = await dialog.showOpenDialog(ventana, {
      title: 'Elegir fondo del chat',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg'] }]
    })
    return r.canceled || !r.filePaths[0] ? servicio.estado() : servicio.elegir(r.filePaths[0])
  })

  ipcMain.handle(CANALES.fondoAjustar, async (e, cambios: unknown): Promise<EstadoFondo> => {
    exigir(e)
    const c = typeof cambios === 'object' && cambios !== null ? (cambios as Record<string, unknown>) : {}
    return servicio.ajustar({
      ...(typeof c['activo'] === 'boolean' ? { activo: c['activo'] } : {}),
      ...(typeof c['visibilidad'] === 'number' && Number.isFinite(c['visibilidad']) ? { visibilidad: c['visibilidad'] } : {})
    })
  })
}
