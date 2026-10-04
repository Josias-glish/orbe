import { BrowserWindow, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { mkdirSync } from 'node:fs'
import {
  CANALES,
  type CambiosRecuerdo,
  type EstadoMemoria,
  type InformeImportacion,
  type InicioMemoria,
  type ResultadoMemoria
} from '../../shared/tipos'
import { ID_VALIDO } from './formato'
import type { ServicioMemoria } from './servicio'

const PETICION_INVALIDA: ResultadoMemoria = { ok: false, error: 'Petición no válida.' }
const MAX_TEXTO_ENTRADA = 20_000

/** Solo se aceptan los campos conocidos y con el tipo esperado: la interfaz no puede colar nada más. */
function limpiarCambios(entrada: unknown): CambiosRecuerdo | null {
  if (typeof entrada !== 'object' || entrada === null) return null
  const e = entrada as Record<string, unknown>
  const cambios: CambiosRecuerdo = {}
  if (e['titulo'] !== undefined) {
    if (typeof e['titulo'] !== 'string' || e['titulo'].length > MAX_TEXTO_ENTRADA) return null
    cambios.titulo = e['titulo']
  }
  if (e['cuerpo'] !== undefined) {
    if (typeof e['cuerpo'] !== 'string' || e['cuerpo'].length > MAX_TEXTO_ENTRADA) return null
    cambios.cuerpo = e['cuerpo']
  }
  if (e['usar'] !== undefined) {
    if (typeof e['usar'] !== 'boolean') return null
    cambios.usar = e['usar']
  }
  if (e['completo'] !== undefined) {
    if (typeof e['completo'] !== 'boolean') return null
    cambios.completo = e['completo']
  }
  return cambios
}

/** Conecta el gestor de memoria del panel con el servicio. Todo se valida aquí: la interfaz no es de fiar. */
export function registrarMemoria(ventana: BrowserWindow, servicio: ServicioMemoria): void {
  const propia = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => e.sender === ventana.webContents
  const exigir = (e: IpcMainInvokeEvent): void => {
    if (!propia(e)) throw new Error('Remitente no autorizado')
  }

  ipcMain.handle(CANALES.memoriaInicio, (e): InicioMemoria => {
    exigir(e)
    return servicio.inicioPanel()
  })

  ipcMain.handle(CANALES.memoriaEstado, (e): EstadoMemoria => {
    exigir(e)
    return servicio.estado()
  })

  ipcMain.handle(CANALES.memoriaGuardar, (e, texto: unknown, forzar: unknown): ResultadoMemoria => {
    exigir(e)
    if (typeof texto !== 'string' || texto.length > MAX_TEXTO_ENTRADA) return PETICION_INVALIDA
    return servicio.guardarNota(texto, forzar === true)
  })

  ipcMain.handle(CANALES.memoriaActualizar, (e, id: unknown, cambios: unknown, forzar: unknown): ResultadoMemoria => {
    exigir(e)
    const limpios = limpiarCambios(cambios)
    if (typeof id !== 'string' || !ID_VALIDO.test(id) || !limpios) return PETICION_INVALIDA
    return servicio.actualizar(id, limpios, forzar === true)
  })

  ipcMain.handle(CANALES.memoriaBorrar, (e, id: unknown): ResultadoMemoria => {
    exigir(e)
    if (typeof id !== 'string' || !ID_VALIDO.test(id)) return PETICION_INVALIDA
    return servicio.borrar(id)
  })

  ipcMain.handle(CANALES.memoriaImportar, (e): { informe: InformeImportacion; estado: EstadoMemoria } => {
    exigir(e)
    const informe = servicio.importar()
    return { informe, estado: servicio.estado() }
  })

  ipcMain.handle(CANALES.memoriaActivar, (e, activa: unknown): ResultadoMemoria => {
    exigir(e)
    if (typeof activa !== 'boolean') return PETICION_INVALIDA
    servicio.fijarActiva(activa)
    return { ok: true, estado: servicio.estado() }
  })

  ipcMain.handle(CANALES.memoriaVaciar, (e): ResultadoMemoria => {
    exigir(e)
    return servicio.vaciar()
  })

  ipcMain.on(CANALES.memoriaCarpeta, (e) => {
    if (!propia(e)) return
    const carpeta = servicio.carpeta
    try {
      mkdirSync(carpeta, { recursive: true })
    } catch {
      // Si no se puede crear, openPath lo dirá.
    }
    void shell.openPath(carpeta)
  })
}
