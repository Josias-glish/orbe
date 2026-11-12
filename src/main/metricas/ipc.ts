import { ipcMain, type BrowserWindow } from 'electron'
import { CUENTAS, type Cuenta } from '../conectores/instagram/cliente'
import { CANALES, type ResultadoMetricas } from '../../shared/tipos'
import type { ServicioMetricas } from './servicio'

/** Conecta las métricas con la pestaña «Métricas». */
export function registrarMetricas(ventana: BrowserWindow, servicio: ServicioMetricas): void {
  ipcMain.handle(CANALES.metricasLeer, async (e, cuenta: unknown, actualizar: unknown): Promise<ResultadoMetricas> => {
    if (e.sender !== ventana.webContents) throw new Error('Remitente no autorizado')
    if (!(CUENTAS as readonly unknown[]).includes(cuenta)) throw new Error('Cuenta no válida')
    const c = cuenta as Cuenta
    const guardado = servicio.guardado(c)
    if (actualizar !== true && guardado) return { ok: true, informe: guardado }
    try {
      return { ok: true, informe: await servicio.leer(c) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), informe: guardado }
    }
  })
}

/**
 * Una foto al día de cada cuenta conectada (seguidores y alcance medio), para ver la evolución aunque no se abra la
 * pestaña. Los fallos se ignoran: es un extra, y la pestaña los enseña cuando se abre.
 */
export function programarFotoDiaria(servicio: ServicioMetricas, conectada: (c: Cuenta) => boolean, hoy: () => string): () => void {
  const tomar = async (): Promise<void> => {
    for (const c of CUENTAS) {
      if (!conectada(c) || servicio.historialDe(c).some((d) => d.fecha === hoy())) continue
      await servicio.leer(c).catch(() => undefined)
    }
  }
  const primera = setTimeout(() => void tomar(), 2 * 60_000)
  const cada = setInterval(() => void tomar(), 6 * 3_600_000)
  primera.unref()
  cada.unref()
  return () => {
    clearTimeout(primera)
    clearInterval(cada)
  }
}
