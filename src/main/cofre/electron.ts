import { clipboard, ipcMain, safeStorage, type BrowserWindow } from 'electron'
import { CANALES } from '../../shared/tipos'
import type { EstadoCofre, ResultadoCofre } from '../../shared/cofre'
import { Cofre, type Cifrador } from './cofre'
import { ControladorCofre } from './ipc'

/** `safeStorage` de Electron: en Windows cifra con DPAPI, ligado a tu usuario de Windows. */
export const cifradorElectron: Cifrador = {
  disponible: () => safeStorage.isEncryptionAvailable(),
  cifrar: (texto) => safeStorage.encryptString(texto),
  descifrar: (datos) => safeStorage.decryptString(datos)
}

/** Crea el cofre y abre sus tres canales (estado, guardar, borrar), solo para la ventana de Orbe. */
export function registrarCofre(ventana: BrowserWindow, ruta: string): Cofre {
  const cofre = new Cofre(ruta, cifradorElectron)
  const control = new ControladorCofre(cofre, { leer: () => clipboard.readText(), vaciar: () => clipboard.clear() })
  const propia = (e: Electron.IpcMainInvokeEvent): boolean => e.sender === ventana.webContents
  ipcMain.handle(CANALES.cofreEstado, (e): EstadoCofre => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    return control.estado()
  })
  ipcMain.handle(CANALES.cofreGuardar, (e, clave: unknown, valor: unknown): Promise<ResultadoCofre> => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    return control.guardar(clave, valor)
  })
  ipcMain.handle(CANALES.cofreBorrar, (e, clave: unknown): ResultadoCofre => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    return control.borrar(clave)
  })
  return cofre
}
