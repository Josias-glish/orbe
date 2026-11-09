import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { CANALES, type EstadoTareas } from '../../shared/tipos'
import type { ServicioTareas } from './servicio'

/** Conecta las tareas de fondo con la interfaz. Solo la ventana de Orbe puede tocarlas. */
export function registrarTareas(ventana: BrowserWindow, servicio: ServicioTareas): void {
  const propia = (e: IpcMainInvokeEvent): void => {
    if (e.sender !== ventana.webContents) throw new Error('Remitente no autorizado')
  }
  const id = (v: unknown): string => (typeof v === 'string' && v.length <= 64 ? v : '')
  ipcMain.handle(CANALES.tareasEstado, (e): EstadoTareas => (propia(e), servicio.estado()))
  ipcMain.handle(CANALES.tareasGuardar, (e, tarea: unknown) => {
    propia(e)
    const r = servicio.guardar(tarea as never)
    if ('error' in r) throw new Error(r.error)
    return r
  })
  ipcMain.handle(CANALES.tareasBorrar, (e, v: unknown) => (propia(e), servicio.borrar(id(v))))
  ipcMain.handle(CANALES.tareasEjecutar, (e, v: unknown) => (propia(e), servicio.ejecutarYa(id(v))))
  ipcMain.handle(CANALES.tareasCancelar, (e, v: unknown) => (propia(e), servicio.cancelar(id(v))))
  ipcMain.handle(CANALES.tareasResponder, (e, v: unknown, c: unknown, permitir: unknown) => {
    propia(e)
    return servicio.responder(id(v), id(c), permitir === true)
  })
}
