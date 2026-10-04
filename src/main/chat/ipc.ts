import { BrowserWindow, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  CANALES,
  type EventoChat,
  type EventoPantalla,
  type InfoChat,
  type LecturaPantalla,
  type ResultadoEnvio
} from '../../shared/tipos'
import type { Consumido } from '../pantalla/pendiente'
import { esEnlaceSeguro } from './enlaces'
import type { ProveedorChat } from './proveedor'
import { ServicioChat } from './servicio'

/** Acceso al contexto de pantalla que el usuario ha pedido leer y que espera al próximo mensaje. */
export interface ReservaContexto {
  consumir(): Consumido | null
  restaurar(consumido: Consumido): LecturaPantalla
  emitir(evento: EventoPantalla): void
}

/** Conecta el chat con la interfaz. Devuelve el servicio para poder cerrarlo al salir. */
export function registrarChat(
  ventana: BrowserWindow,
  proveedor: ProveedorChat,
  info: InfoChat,
  reserva?: ReservaContexto
): ServicioChat {
  const propia = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => e.sender === ventana.webContents
  /** Turno en curso que lleva contexto de pantalla: si falla, ese contexto vuelve a la reserva. */
  let turnoConContexto: { id: string; consumido: Consumido } | null = null

  const servicio = new ServicioChat(proveedor, (evento: EventoChat) => {
    if (turnoConContexto && evento.id === turnoConContexto.id) {
      if (evento.tipo === 'error') {
        // El envío falló: el contexto vuelve para poder reintentar sin tener que leer la pantalla otra vez.
        const lectura = reserva?.restaurar(turnoConContexto.consumido)
        turnoConContexto = null
        if (lectura) reserva?.emitir({ tipo: 'pendiente', lectura, origen: 'restaurado' })
      } else if (evento.tipo === 'fin') {
        turnoConContexto = null
      }
    }
    if (!ventana.isDestroyed()) ventana.webContents.send(CANALES.chatEvento, evento)
  })

  ipcMain.handle(CANALES.chatInfo, (e) => (propia(e) ? info : null))

  ipcMain.handle(CANALES.chatEnviar, (e, peticion: unknown): ResultadoEnvio => {
    if (!propia(e)) throw new Error('Remitente no autorizado')

    // El contexto solo se adjunta si el usuario lo pidió (leyó la pantalla) y lo deja en la reserva.
    const quiereContexto =
      typeof peticion === 'object' && peticion !== null && (peticion as { conContexto?: unknown }).conContexto === true
    const consumido = quiereContexto ? (reserva?.consumir() ?? null) : null

    const resultado = servicio.iniciar(peticion, consumido?.contexto)
    if (!resultado.ok) {
      if (consumido) reserva?.restaurar(consumido)
      return resultado
    }
    if (consumido) {
      turnoConContexto = { id: (peticion as { id: string }).id, consumido }
      reserva?.emitir({ tipo: 'vacio', motivo: 'enviado' })
    }
    return { ok: true, adjuntos: consumido?.lectura.partes ?? [] }
  })

  ipcMain.on(CANALES.chatCancelar, (e, id: unknown) => {
    if (propia(e) && typeof id === 'string') servicio.cancelar(id)
  })
  ipcMain.handle(CANALES.chatNueva, (e) => {
    if (propia(e)) servicio.nueva()
  })
  ipcMain.on(CANALES.chatPrecalentar, (e) => {
    if (propia(e)) servicio.precalentar()
  })
  ipcMain.on(CANALES.abrirEnlace, (e, url: unknown) => {
    if (propia(e) && esEnlaceSeguro(url)) void shell.openExternal(url)
  })

  return servicio
}
