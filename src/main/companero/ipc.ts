import { ipcMain } from 'electron'
import { ACCIONES_BOCADILLO, type AccionBocadillo, type ComentarioCompanero } from '../../shared/companero'
import { CANALES } from '../../shared/tipos'
import type { VentanaOrbe } from '../ventana'
import type { Companero } from './servicio'

/** Enseña un bocadillo: la ventana plegada crece sin robar el foco y el globo aparece al otro lado del personaje. */
export function mostrarBocadillo(orbe: VentanaOrbe, c: ComentarioCompanero): boolean {
  const ancla = orbe.mostrarBocadillo(true)
  if (!ancla) return false
  orbe.ventana.webContents.send(CANALES.companeroComentario, { comentario: c, ancla })
  return true
}

/** [Profundizar] abre el panel con el borrador (lo envías tú); el resto devuelve la ventana a su tamaño. */
export function registrarCompanero(orbe: VentanaOrbe, companero: () => Companero | null): void {
  ipcMain.on(CANALES.companeroResponder, (e, id: unknown, accion: unknown) => {
    if (orbe.ventana.isDestroyed() || e.sender !== orbe.ventana.webContents) return
    if (typeof id !== 'string' || !ACCIONES_BOCADILLO.includes(accion as AccionBocadillo)) return
    companero()?.responder(id, accion as AccionBocadillo)
    if (accion === 'profundizar') orbe.establecerExpandido(true)
    else orbe.mostrarBocadillo(false)
  })
}
