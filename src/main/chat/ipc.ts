import { BrowserWindow, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { CANALES, type EventoChat, type InfoChat } from '../../shared/tipos'
import { esEnlaceSeguro } from './enlaces'
import type { ProveedorChat } from './proveedor'
import { ServicioChat } from './servicio'

/** Conecta el chat con la interfaz. Devuelve el servicio para poder cerrarlo al salir. */
export function registrarChat(ventana: BrowserWindow, proveedor: ProveedorChat, info: InfoChat): ServicioChat {
  const propia = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => e.sender === ventana.webContents

  const servicio = new ServicioChat(proveedor, (evento: EventoChat) => {
    if (!ventana.isDestroyed()) ventana.webContents.send(CANALES.chatEvento, evento)
  })

  ipcMain.handle(CANALES.chatInfo, (e) => (propia(e) ? info : null))
  ipcMain.handle(CANALES.chatEnviar, (e, peticion: unknown) => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    return servicio.iniciar(peticion)
  })
  ipcMain.on(CANALES.chatCancelar, (e, id: unknown) => {
    if (propia(e) && typeof id === 'string') servicio.cancelar(id)
  })
  ipcMain.handle(CANALES.chatNueva, (e) => {
    if (propia(e)) servicio.nueva()
  })
  ipcMain.on(CANALES.chatPrecalentar, (e) => {
    if (propia(e)) servicio.precalentar()
  })
  ipcMain.on(CANALES.abrirEnlace, (e, url: unknown) => {
    if (propia(e) && esEnlaceSeguro(url)) void shell.openExternal(url)
  })

  return servicio
}
