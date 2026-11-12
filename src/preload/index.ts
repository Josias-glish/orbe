import { contextBridge, ipcRenderer } from 'electron'
import {
  CANALES,
  type ApiOrbe,
  type EstadoVentana,
  type EventoChat,
  type ConfigVista,
  type EventoActividad,
  type EventoEntorno,
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
  ratonInteractivo: (dentro) => ipcRenderer.send(CANALES.ratonInteractivo, dentro === true),
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
  autoInfo: () => ipcRenderer.invoke(CANALES.autoInfo),
  autoFijar: (activo) => ipcRenderer.invoke(CANALES.autoFijar, activo),
  chatPrecalentar: () => ipcRenderer.send(CANALES.chatPrecalentar),
  alEventoChat: (cb) => suscribir<EventoChat>(CANALES.chatEvento, cb),

  pantallaLeer: () => ipcRenderer.invoke(CANALES.pantallaLeer),
  pantallaQuitar: (clave) => ipcRenderer.invoke(CANALES.pantallaQuitar, clave),
  pantallaDescartar: () => ipcRenderer.send(CANALES.pantallaDescartar),
  pantallaCapturar: () => ipcRenderer.invoke(CANALES.pantallaCapturar),
  pantallaTextoImagen: (origen) => ipcRenderer.invoke(CANALES.pantallaTextoImagen, origen),
  pantallaFormula: (origen) => ipcRenderer.invoke(CANALES.pantallaFormula, origen),
  alEventoPantalla: (cb) => suscribir<EventoPantalla>(CANALES.pantallaEvento, cb),
  alOrdenApp: (cb) => suscribir<OrdenApp>(CANALES.appOrden, cb),
  fijarPanel: (fijar) => ipcRenderer.invoke(CANALES.ventanaFijar, fijar),
  salirDeOrbe: () => ipcRenderer.invoke(CANALES.appSalir),
  configLeer: (): Promise<ConfigVista> => ipcRenderer.invoke(CANALES.configLeer),
  configGuardar: (peticion: PeticionConfig): Promise<ResultadoConfig> => ipcRenderer.invoke(CANALES.configGuardar, peticion),
  configElegirRive: () => ipcRenderer.invoke(CANALES.configElegirRive),
  personajeRecursos: () => ipcRenderer.invoke(CANALES.personajeRecursos),
  alCursor: (cb) => suscribir<{ x: number; y: number }>(CANALES.personajeCursor, cb),
  alEntorno: (cb) => suscribir<EventoEntorno>(CANALES.personajeEntorno, cb),
  alActividad: (cb) => suscribir<EventoActividad>(CANALES.actividadEvento, cb),
  actividadHistorial: () => ipcRenderer.invoke(CANALES.actividadHistorial),
  tareasEstado: () => ipcRenderer.invoke(CANALES.tareasEstado),
  tareasGuardar: (tarea) => ipcRenderer.invoke(CANALES.tareasGuardar, tarea),
  tareasBorrar: (id) => ipcRenderer.invoke(CANALES.tareasBorrar, id),
  tareasEjecutar: (id) => ipcRenderer.invoke(CANALES.tareasEjecutar, id),
  tareasCancelar: (id) => ipcRenderer.invoke(CANALES.tareasCancelar, id),
  tareasResponder: (id, confirmacionId, permitir) => ipcRenderer.invoke(CANALES.tareasResponder, id, confirmacionId, permitir),
  alTareas: (cb) => suscribir<null>(CANALES.tareasCambio, () => cb()),
  usoResumen: () => ipcRenderer.invoke(CANALES.usoResumen),
  usoBorrar: () => ipcRenderer.invoke(CANALES.usoBorrar),
  alUso: (cb) => suscribir<null>(CANALES.usoCambio, () => cb()),

  vozInfo: () => ipcRenderer.invoke(CANALES.vozInfo),
  vozTranscribir: (audio, mime) => ipcRenderer.invoke(CANALES.vozTranscribir, audio, mime),
  vozSintetizar: (texto) => ipcRenderer.invoke(CANALES.vozSintetizar, texto),

  fondoEstado: () => ipcRenderer.invoke(CANALES.fondoEstado),
  fondoSiguiente: () => ipcRenderer.invoke(CANALES.fondoSiguiente),
  fondoAjustar: (cambios) => ipcRenderer.invoke(CANALES.fondoAjustar, cambios),
  fondoElegir: () => ipcRenderer.invoke(CANALES.fondoElegir),

  memoriaInicio: () => ipcRenderer.invoke(CANALES.memoriaInicio),
  memoriaEstado: () => ipcRenderer.invoke(CANALES.memoriaEstado),
  memoriaGuardar: (texto, forzar) => ipcRenderer.invoke(CANALES.memoriaGuardar, texto, forzar),
  memoriaActualizar: (id, cambios, forzar) => ipcRenderer.invoke(CANALES.memoriaActualizar, id, cambios, forzar),
  memoriaBorrar: (id) => ipcRenderer.invoke(CANALES.memoriaBorrar, id),
  memoriaImportar: () => ipcRenderer.invoke(CANALES.memoriaImportar),
  memoriaActivar: (activa) => ipcRenderer.invoke(CANALES.memoriaActivar, activa),
  memoriaCarpeta: () => ipcRenderer.send(CANALES.memoriaCarpeta),
  memoriaVaciar: () => ipcRenderer.invoke(CANALES.memoriaVaciar),

  cofreEstado: () => ipcRenderer.invoke(CANALES.cofreEstado),
  cofreGuardar: (clave, valor) => ipcRenderer.invoke(CANALES.cofreGuardar, clave, valor),
  cofreBorrar: (clave) => ipcRenderer.invoke(CANALES.cofreBorrar, clave),
  gmailConectar: () => ipcRenderer.invoke(CANALES.gmailConectar),
  gmailCancelar: () => ipcRenderer.send(CANALES.gmailCancelar),

  metricasLeer: (cuenta, actualizar) => ipcRenderer.invoke(CANALES.metricasLeer, cuenta, actualizar)
}

contextBridge.exposeInMainWorld('orbe', api)
