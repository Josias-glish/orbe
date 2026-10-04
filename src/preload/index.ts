import { contextBridge, ipcRenderer } from 'electron'
import { CANALES, type ApiOrbe, type EstadoVentana } from '../shared/tipos'

const api: ApiOrbe = {
  alternar: () => ipcRenderer.send(CANALES.alternar),
  arrastreInicio: (x, y) => ipcRenderer.send(CANALES.arrastreInicio, x, y),
  arrastreMover: (x, y) => ipcRenderer.send(CANALES.arrastreMover, x, y),
  arrastreFin: () => ipcRenderer.send(CANALES.arrastreFin),
  alCambiarExpandido: (cb) => {
    const escucha = (_: unknown, estado: EstadoVentana): void => cb(estado)
    ipcRenderer.on(CANALES.expandidoCambio, escucha)
    return () => ipcRenderer.removeListener(CANALES.expandidoCambio, escucha)
  },
  alCambiarVisibilidad: (cb) => {
    const escucha = (_: unknown, visible: boolean): void => cb(visible)
    ipcRenderer.on(CANALES.visibilidad, escucha)
    return () => ipcRenderer.removeListener(CANALES.visibilidad, escucha)
  }
}

contextBridge.exposeInMainWorld('orbe', api)
