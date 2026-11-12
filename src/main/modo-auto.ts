import { BrowserWindow, ipcMain } from 'electron'
import { CANALES } from '../shared/tipos'

// ponytail: estado global del proceso (un solo usuario y una sola ventana); se lee al empezar cada tarea.
let activo = false

/** Modo auto: el agente hace todo sin preguntar salvo pagos y compras (lo bloqueado sigue bloqueado). Lo lee cada tarea nueva. */
export const modoAutoActivo = (): boolean => activo

/** El interruptor del chat: cambia al momento, sin reiniciar, y se recuerda entre sesiones. */
export function registrarModoAuto(ventana: BrowserWindow, inicial: boolean, guardar: (activo: boolean) => void): void {
  activo = inicial
  const propia = (e: Electron.IpcMainInvokeEvent): void => {
    if (e.sender !== ventana.webContents) throw new Error('Remitente no autorizado')
  }
  ipcMain.handle(CANALES.autoInfo, (e): boolean => (propia(e), activo))
  ipcMain.handle(CANALES.autoFijar, (e, pedido: unknown): boolean => {
    propia(e)
    if (typeof pedido === 'boolean' && pedido !== activo) {
      activo = pedido
      guardar(activo)
    }
    return activo
  })
}
