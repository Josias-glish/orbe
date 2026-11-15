import { textosSistema } from '../shared/sistema'

/** Nombre del sistema y atajos tal como se le enseñan al usuario. Fuera de Electron (pruebas), los de Windows. */
export const SO = textosSistema(typeof window !== 'undefined' && window.orbe ? window.orbe.plataforma : 'win32')
