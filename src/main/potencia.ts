import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { CANALES, NIVELES_ESFUERZO, type InfoPotencia, type NivelEsfuerzo } from '../shared/tipos'
import type { ProveedorChat } from './chat/proveedor'

export function esNivelEsfuerzo(valor: unknown): valor is NivelEsfuerzo {
  return typeof valor === 'string' && (NIVELES_ESFUERZO as readonly string[]).includes(valor)
}

/** El nivel que vale al arrancar: el que dejó el usuario con el marcador (si es válido) o, si no, el de la configuración. */
export function nivelInicial(guardado: unknown, deConfiguracion: NivelEsfuerzo): NivelEsfuerzo {
  return esNivelEsfuerzo(guardado) ? guardado : deConfiguracion
}

export interface OpcionesPotencia {
  ventana: BrowserWindow
  proveedor: ProveedorChat
  /** El nivel con el que empieza Orbe. */
  nivel: NivelEsfuerzo
  /** Guarda el nivel elegido para la próxima vez. */
  guardar(nivel: NivelEsfuerzo): void
}

/** Conecta el marcador de potencia de la cabecera con el proveedor de chat y con los ajustes guardados. */
export function registrarPotencia(o: OpcionesPotencia): void {
  let nivel = o.nivel
  o.proveedor.establecerEsfuerzo?.(nivel)

  const exigir = (e: IpcMainInvokeEvent): void => {
    if (e.sender !== o.ventana.webContents) throw new Error('Remitente no autorizado')
  }
  const info = (): InfoPotencia => ({ nivel, aplica: o.proveedor.aplicaEsfuerzo ?? 'segun_servicio' })

  ipcMain.handle(CANALES.potenciaInfo, (e): InfoPotencia => {
    exigir(e)
    return info()
  })
  ipcMain.handle(CANALES.potenciaFijar, (e, pedido: unknown): InfoPotencia => {
    exigir(e)
    if (!esNivelEsfuerzo(pedido)) return info()
    nivel = pedido
    o.proveedor.establecerEsfuerzo?.(nivel)
    o.guardar(nivel)
    return info()
  })
}
