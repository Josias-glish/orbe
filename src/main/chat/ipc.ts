import { BrowserWindow, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  CANALES,
  type EventoChat,
  type EventoPantalla,
  type InfoChat,
  type LecturaPantalla,
  type ResultadoEnvio
} from '../../shared/tipos'
import type { CapturaMemoria } from '../memoria/servicio'
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

/** Lo que el chat necesita de la memoria: órdenes de «recuerda que…», la conversación anterior y el registro de turnos. */
export interface MemoriaChat {
  capturar(texto: string): CapturaMemoria | null
  tomarHistorialPrevio(): string | null
  confirmarHistorialUsado(): void
  turnoCompletado(usuario: string, asistente: string): void
  nuevaConversacion(): void
}

interface TurnoRegistrado {
  id: string
  usuario: string
  respuesta: string
  /** El mensaje llevó la conversación anterior: se da por usada cuando el turno termina. */
  conHistorial: boolean
}

/** Conecta el chat con la interfaz. Devuelve el servicio para poder cerrarlo al salir. */
export function registrarChat(
  ventana: BrowserWindow,
  proveedor: ProveedorChat,
  info: InfoChat,
  reserva?: ReservaContexto,
  memoria?: MemoriaChat
): ServicioChat {
  const propia = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => e.sender === ventana.webContents
  /** Turno en curso que lleva contexto de pantalla: si falla, ese contexto vuelve a la reserva. */
  let turnoConContexto: { id: string; consumido: Consumido } | null = null
  /** Turno en curso cuya respuesta se va guardando para poder seguir la conversación tras reiniciar Orbe. */
  let turnoRegistrado: TurnoRegistrado | null = null

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
    if (turnoRegistrado && evento.id === turnoRegistrado.id) {
      if (evento.tipo === 'texto') {
        turnoRegistrado.respuesta += evento.delta
      } else if (evento.tipo === 'fin') {
        memoria?.turnoCompletado(turnoRegistrado.usuario, turnoRegistrado.respuesta)
        if (turnoRegistrado.conHistorial) memoria?.confirmarHistorialUsado()
        turnoRegistrado = null
      } else if (evento.tipo === 'error') {
        turnoRegistrado = null
      }
    }
    if (!ventana.isDestroyed()) ventana.webContents.send(CANALES.chatEvento, evento)
  })

  ipcMain.handle(CANALES.chatInfo, (e) => (propia(e) ? info : null))

  ipcMain.handle(CANALES.chatEnviar, (e, peticion: unknown): ResultadoEnvio => {
    if (!propia(e)) throw new Error('Remitente no autorizado')

    // Primero se comprueba que el envío es posible: así no se gasta contexto, memoria ni conversación anterior en vano.
    const comprobada = servicio.comprobar(peticion)
    if (!comprobada.ok) return comprobada
    const { id, texto } = comprobada.peticion

    // El contexto solo se adjunta si el usuario lo pidió (leyó la pantalla) y lo deja en la reserva.
    const quiereContexto =
      typeof peticion === 'object' && peticion !== null && (peticion as { conContexto?: unknown }).conContexto === true
    const consumido = quiereContexto ? (reserva?.consumir() ?? null) : null

    // «Recuerda que…»: lo guarda la aplicación (no el modelo) y se lo cuenta al modelo con una nota.
    const captura = memoria?.capturar(texto) ?? null
    const historialPrevio = memoria?.tomarHistorialPrevio() ?? undefined

    const resultado = servicio.iniciar(peticion, consumido?.contexto, { historialPrevio, notaApp: captura?.nota })
    if (!resultado.ok) {
      if (consumido) reserva?.restaurar(consumido)
      return resultado
    }
    turnoRegistrado = { id, usuario: texto, respuesta: '', conHistorial: historialPrevio !== undefined }
    if (consumido) {
      turnoConContexto = { id, consumido }
      reserva?.emitir({ tipo: 'vacio', motivo: 'enviado' })
    }
    return { ok: true, adjuntos: consumido?.lectura.partes ?? [], ...(captura ? { memoria: captura.aviso } : {}) }
  })

  ipcMain.on(CANALES.chatCancelar, (e, id: unknown) => {
    if (propia(e) && typeof id === 'string') servicio.cancelar(id)
  })
  ipcMain.handle(CANALES.chatNueva, (e) => {
    if (!propia(e)) return
    servicio.nueva()
    memoria?.nuevaConversacion()
    turnoRegistrado = null
  })
  ipcMain.on(CANALES.chatPrecalentar, (e) => {
    if (propia(e)) servicio.precalentar()
  })
  ipcMain.on(CANALES.abrirEnlace, (e, url: unknown) => {
    if (propia(e) && esEnlaceSeguro(url)) void shell.openExternal(url)
  })

  return servicio
}
