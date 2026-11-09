import { ipcMain, type BrowserWindow } from 'electron'
import { CANALES, type ResumenUso } from '../../shared/tipos'
import type { ContadorUso } from '../chat/servicio'
import type { Proveedor, RegistroUso } from './registro'

/** Conecta el registro de consumo con la interfaz y devuelve el contador que usa el chat. */
export function registrarUso(ventana: BrowserWindow, registro: RegistroUso, proveedor: () => { nombre: Proveedor; modelo: string }): ContadorUso {
  const propia = (e: Electron.IpcMainInvokeEvent): boolean => e.sender === ventana.webContents
  ipcMain.handle(CANALES.usoResumen, (e): ResumenUso => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    return registro.resumen()
  })
  ipcMain.handle(CANALES.usoBorrar, (e): ResumenUso => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
    registro.borrar()
    return registro.resumen()
  })
  const avisar = (): void => {
    if (!ventana.isDestroyed()) ventana.webContents.send(CANALES.usoCambio)
  }
  return {
    uso: (uso) => {
      const p = proveedor()
      registro.anotar(p.nombre, p.modelo, uso)
      avisar()
    },
    limite: (limite) => {
      registro.anotarLimite(limite)
      avisar()
    }
  }
}
