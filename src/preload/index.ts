import { contextBridge, ipcRenderer } from 'electron'
import {
  CANALES,
  type ApiOrbe,
  type EstadoVentana,
  type EventoChat,
  type ConfigVista,
  type EventoPantalla,
  type OrdenApp,
  type PeticionConfig,
  type ResultadoConfig
} from '../shared/tipos'

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
  redimensionarInicio: (x, y, modo) => ipcRenderer.send(CANALES.redimensionarInicio, x, y, modo),
  redimensionarMover: (x, y) => ipcRenderer.send(CANALES.redimensionarMover, x, y),
  redimensionarFin: () => ipcRenderer.send(CANALES.redimensionarFin),
  alCambiarExpandido: (cb) => suscribir<EstadoVentana>(CANALES.expandidoCambio, cb),
  alCambiarVisibilidad: (cb) => suscribir<boolean>(CANALES.visibilidad, cb),
  abrirEnlace: (url) => ipcRenderer.send(CANALES.abrirEnlace, url),

  chatInfo: () => ipcRenderer.invoke(CANALES.chatInfo),
  chatEnviar: (peticion) => ipcRenderer.invoke(CANALES.chatEnviar, peticion),
  chatCancelar: (id) => ipcRenderer.send(CANALES.chatCancelar, id),
  chatConfirmar: (id, confirmacionId, permitir) => ipcRenderer.send(CANALES.chatConfirmar, id, confirmacionId, permitir),
  chatNueva: () => ipcRenderer.invoke(CANALES.chatNueva),
  potenciaInfo: () => ipcRenderer.invoke(CANALES.potenciaInfo),
  potenciaFijar: (nivel) => ipcRenderer.invoke(CANALES.potenciaFijar, nivel),
  chatPrecalentar: () => ipcRenderer.send(CANALES.chatPrecalentar),
  alEventoChat: (cb) => suscribir<EventoChat>(CANALES.chatEvento, cb),

  pantallaLeer: () => ipcRenderer.invoke(CANALES.pantallaLeer),
  pantallaQuitar: (clave) => ipcRenderer.invoke(CANALES.pantallaQuitar, clave),
  pantallaDescartar: () => ipcRenderer.send(CANALES.pantallaDescartar),
  pantallaCapturar: () => ipcRenderer.invoke(CANALES.pantallaCapturar),
  alEventoPantalla: (cb) => suscribir<EventoPantalla>(CANALES.pantallaEvento, cb),
  alOrdenApp: (cb) => suscribir<OrdenApp>(CANALES.appOrden, cb),
  fijarPanel: (fijar) => ipcRenderer.invoke(CANALES.ventanaFijar, fijar),
  salirDeOrbe: () => ipcRenderer.invoke(CANALES.appSalir),
  configLeer: (): Promise<ConfigVista> => ipcRenderer.invoke(CANALES.configLeer),
  configGuardar: (peticion: PeticionConfig): Promise<ResultadoConfig> => ipcRenderer.invoke(CANALES.configGuardar, peticion),

  vozInfo: () => ipcRenderer.invoke(CANALES.vozInfo),
  vozTranscribir: (audio, mime) => ipcRenderer.invoke(CANALES.vozTranscribir, audio, mime),
  vozSintetizar: (texto) => ipcRenderer.invoke(CANALES.vozSintetizar, texto),

  fondoEstado: () => ipcRenderer.invoke(CANALES.fondoEstado),
  fondoSiguiente: () => ipcRenderer.invoke(CANALES.fondoSiguiente),
  fondoAjustar: (cambios) => ipcRenderer.invoke(CANALES.fondoAjustar, cambios),

  memoriaInicio: () => ipcRenderer.invoke(CANALES.memoriaInicio),
  memoriaEstado: () => ipcRenderer.invoke(CANALES.memoriaEstado),
  memoriaGuardar: (texto, forzar) => ipcRenderer.invoke(CANALES.memoriaGuardar, texto, forzar),
  memoriaActualizar: (id, cambios, forzar) => ipcRenderer.invoke(CANALES.memoriaActualizar, id, cambios, forzar),
  memoriaBorrar: (id) => ipcRenderer.invoke(CANALES.memoriaBorrar, id),
  memoriaImportar: () => ipcRenderer.invoke(CANALES.memoriaImportar),
  memoriaActivar: (activa) => ipcRenderer.invoke(CANALES.memoriaActivar, activa),
  memoriaCarpeta: () => ipcRenderer.send(CANALES.memoriaCarpeta),
  memoriaVaciar: () => ipcRenderer.invoke(CANALES.memoriaVaciar)
}

contextBridge.exposeInMainWorld('orbe', api)
