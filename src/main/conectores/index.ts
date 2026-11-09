import { app, ipcMain } from 'electron'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CANALES, type EstadoActividad } from '../../shared/tipos'
import type { Config } from '../entorno'
import type { VentanaOrbe } from '../ventana'
import { BusActividad } from './actividad'
import { configHooksClaudeCode } from './hooks'
import { ServidorEventos } from './servidor'

/**
 * Conecta Orbe con otras herramientas. Hoy: un receptor local de avisos (Claude Code por sus hooks, n8n, scripts…)
 * que el personaje muestra con una expresión y que se listan en el panel. Es la base para más conectores: cualquier
 * cosa que publique en el bus aparece igual. Apagado salvo ORBE_EVENTOS=1.
 */
export async function registrarConectores(opciones: { ventana: VentanaOrbe; config: Config; carpetaDatos: string; modoHumo: boolean }): Promise<BusActividad> {
  const { ventana, config } = opciones
  const bus = new BusActividad()
  const archivo = join(opciones.carpetaDatos, 'conectores.json')
  let puerto: number | null = null

  bus.suscribir((evento) => {
    const w = ventana.ventana
    if (!w.isDestroyed()) w.webContents.send(CANALES.actividadEvento, evento)
  })
  const scriptIncluido = app.isPackaged ? join(process.resourcesPath, 'conectores', 'orbe-evento.mjs') : join(app.getAppPath(), 'resources', 'conectores', 'orbe-evento.mjs')
  // Los hooks de Claude Code apuntan a una copia fija en la carpeta de datos (%APPDATA%\orbe\conectores): así siguen
  // funcionando aunque muevas o borres la carpeta de Orbe (p. ej., la del .zip en Descargas) o lo actualices.
  let script = scriptIncluido
  if (!opciones.modoHumo) {
    try {
      const fijo = join(opciones.carpetaDatos, 'conectores', 'orbe-evento.mjs')
      mkdirSync(join(opciones.carpetaDatos, 'conectores'), { recursive: true })
      copyFileSync(scriptIncluido, fijo)
      script = fijo
    } catch {
      // sin copia, los hooks usan el script de la instalación
    }
  }
  ipcMain.handle(CANALES.actividadHistorial, (e): EstadoActividad => {
    if (e.sender !== ventana.ventana.webContents) throw new Error('Remitente no autorizado')
    return { activo: puerto !== null, puerto, archivo: puerto !== null ? archivo : null, configClaudeCode: configHooksClaudeCode(script), eventos: bus.ultimos() }
  })

  // En la prueba de humo nunca se abre un puerto ni se escribe en la carpeta de datos real.
  if (!config.eventos.activo || opciones.modoHumo) return bus

  const servidor = new ServidorEventos(bus)
  try {
    let datos
    try {
      datos = await servidor.iniciar(config.eventos.puerto)
    } catch {
      // Puerto ocupado: se usa uno libre (el archivo dice cuál).
      datos = await servidor.iniciar(0)
    }
    puerto = datos.puerto
    writeFileSync(archivo, JSON.stringify({ puerto: datos.puerto, token: datos.token, version: 1 }, null, 2), { encoding: 'utf8', mode: 0o600 })
    app.once('will-quit', () => {
      servidor.detener()
      try {
        rmSync(archivo, { force: true })
      } catch {
        // si no se puede borrar, el token deja de valer igualmente al cerrar Orbe
      }
    })
  } catch (error) {
    console.warn('[orbe] No he podido abrir el receptor de avisos:', error)
  }
  return bus
}

