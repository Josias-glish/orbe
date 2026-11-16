import { BrowserWindow, ipcMain } from 'electron'
import { CANALES } from '../../shared/tipos'
import type { TurnoEntrada } from './contenido'
import type { Esfuerzo, ManejadoresTurno, ProveedorChat, ResultadoTurno } from './proveedor'

/**
 * «🔒 Privado» (COMPANERO-Y-CONFIGURACION.md A.7): con el interruptor puesto, lo que escribes va solo al modelo local
 * de Ollama, sin herramientas. Lo eliges tú: no hay enrutado automático que pueda mandar a la nube algo privado.
 */
export class ProveedorConmutable implements ProveedorChat {
  private enPrivado = false

  constructor(
    private readonly profundo: ProveedorChat,
    private readonly local: ProveedorChat
  ) {}

  private get activo(): ProveedorChat {
    return this.enPrivado ? this.local : this.profundo
  }

  get privado(): boolean {
    return this.enPrivado
  }

  /** Cambiar de cerebro corta lo que haya en curso y empieza una conversación limpia (la vista también se vacía). */
  fijarPrivado(valor: boolean): void {
    if (valor === this.enPrivado) return
    this.activo.cancelar()
    this.enPrivado = valor
    this.activo.reiniciar()
  }

  get nombre(): ProveedorChat['nombre'] {
    return this.activo.nombre
  }
  get modelo(): string {
    return this.activo.modelo
  }
  get aplicaEsfuerzo(): ProveedorChat['aplicaEsfuerzo'] {
    return this.profundo.aplicaEsfuerzo
  }
  enviar(turno: TurnoEntrada, manejadores: ManejadoresTurno): Promise<ResultadoTurno> {
    return this.activo.enviar(turno, manejadores)
  }
  cancelar(): void {
    this.activo.cancelar()
  }
  reiniciar(): void {
    this.activo.reiniciar()
  }
  precalentar(): void {
    this.activo.precalentar?.()
  }
  establecerEsfuerzo(nivel: Esfuerzo): void {
    this.profundo.establecerEsfuerzo?.(nivel)
  }
  cerrar(): void {
    this.profundo.cerrar()
    this.local.cerrar()
  }
}

/** El interruptor del chat. No se recuerda entre sesiones: Orbe arranca siempre con el cerebro profundo. */
export function registrarPrivado(ventana: BrowserWindow, proveedor: ProveedorConmutable, alCambiar?: () => void): void {
  const propia = (e: Electron.IpcMainInvokeEvent): void => {
    if (e.sender !== ventana.webContents) throw new Error('Remitente no autorizado')
  }
  ipcMain.handle(CANALES.privadoInfo, (e): boolean => (propia(e), proveedor.privado))
  ipcMain.handle(CANALES.privadoFijar, (e, pedido: unknown): boolean => {
    propia(e)
    if (typeof pedido === 'boolean' && pedido !== proveedor.privado) {
      proveedor.fijarPrivado(pedido)
      alCambiar?.()
    }
    return proveedor.privado
  })
}
