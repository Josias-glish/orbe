import { contextBridge, ipcRenderer } from 'electron'
import { CANALES, type ApiOrbe, type EstadoVentana, type EventoChat } from '../shared/tipos'

/** Suscripción a un canal que devuelve la función para cancelarla. */
function suscribir<T>(canal: string, cb: (valor: T) => void): () => void {
  const escucha = (_: unknown, valor: T): void => cb(valor)
  ipcRenderer.on(canal, escucha)
  return () => ipcRenderer.removeListener(canal, escucha)
}

const api: ApiOrbe = {
  alternar: () => ipcRenderer.send(CANALES.alternar),
  arrastreInicio: (x, y) => ipcRenderer.send(CANALES.arrastreInicio, x, y),
  arrastreMover: (x, y) => ipcRenderer.send(CANALES.arrastreMover, x, y),
  arrastreFin: () => ipcRenderer.send(CANALES.arrastreFin),
  alCambiarExpandido: (cb) => suscribir<EstadoVentana>(CANALES.expandidoCambio, cb),
  alCambiarVisibilidad: (cb) => suscribir<boolean>(CANALES.visibilidad, cb),
  abrirEnlace: (url) => ipcRenderer.send(CANALES.abrirEnlace, url),

  chatInfo: () => ipcRenderer.invoke(CANALES.chatInfo),
  chatEnviar: (peticion) => ipcRenderer.invoke(CANALES.chatEnviar, peticion),
  chatCancelar: (id) => ipcRenderer.send(CANALES.chatCancelar, id),
  chatNueva: () => ipcRenderer.invoke(CANALES.chatNueva),
  chatPrecalentar: () => ipcRenderer.send(CANALES.chatPrecalentar),
  alEventoChat: (cb) => suscribir<EventoChat>(CANALES.chatEvento, cb)
}

contextBridge.exposeInMainWorld('orbe', api)
