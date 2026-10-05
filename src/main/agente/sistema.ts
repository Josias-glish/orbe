import { execFile, spawn } from 'node:child_process'
import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { shell } from 'electron'
import { CatalogoAplicaciones, leerAppsTienda, leerConfigApps, type ConfigApps, type DepsCatalogo } from './aplicaciones'
import type { DepsAbrirUrl } from './herramientas/abrir-url'
import type { LanzadorApps } from './herramientas/abrir-aplicacion'

/**
 * Lo único de Windows y de Electron que tocan las herramientas de abrir sitios y aplicaciones. Está aparte para que el
 * resto (política, catálogo, herramientas) se pruebe sin Electron: aquí no hay ninguna decisión, solo las llamadas al sistema.
 */
export interface DepsSistema {
  abrirUrl: DepsAbrirUrl
  catalogo: CatalogoAplicaciones
  lanzador: LanzadorApps
}

/** Script fijo que lista las apps de Microsoft Store del menú Inicio. No lleva nada que venga del modelo. */
const SCRIPT_APPS_TIENDA =
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
  "Get-StartApps | Where-Object { $_.AppID -like '*!*' } | ForEach-Object { [pscustomobject]@{ n = $_.Name; i = $_.AppID } } | ConvertTo-Json -Compress"

function rutaPowerShell(): string {
  return join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function listarAppsTienda(): Promise<Array<{ nombre: string; appId: string }>> {
  return new Promise((resolver) => {
    execFile(
      rutaPowerShell(),
      ['-NoProfile', '-NonInteractive', '-Command', SCRIPT_APPS_TIENDA],
      { timeout: 20_000, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
      (error, salida) => {
        if (error) return resolver([])
        try {
          resolver(leerAppsTienda(salida))
        } catch {
          resolver([])
        }
      }
    )
  })
}

/** Abre una app de la Store con el Explorador de Windows; su código de salida no dice si funcionó, así que solo se comprueba que arranca. */
function abrirTienda(appId: string): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const hijo = spawn(join(process.env['SystemRoot'] ?? 'C:\\Windows', 'explorer.exe'), [`shell:AppsFolder\\${appId}`], {
      detached: true,
      stdio: 'ignore'
    })
    hijo.once('error', rechazar)
    hijo.once('spawn', () => {
      hijo.unref()
      resolver()
    })
  })
}

async function abrirRuta(ruta: string): Promise<void> {
  const error = await shell.openPath(ruta)
  if (error) throw new Error(`Windows no pudo abrirla: ${error}`)
}

/** Las carpetas «Programas» del menú Inicio: la del usuario primero, que gana si un nombre se repite. */
function carpetasInicio(): string[] {
  const rutas = [
    process.env['APPDATA'] && join(process.env['APPDATA'], 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    process.env['ProgramData'] && join(process.env['ProgramData'], 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ]
  return rutas.filter((r): r is string => typeof r === 'string')
}

export function crearDepsSistema(datosApp: string): DepsSistema {
  const archivoConfig = join(datosApp, 'aplicaciones.json')
  const depsCatalogo: DepsCatalogo = {
    carpetasInicio: carpetasInicio(),
    listarDirectorio: async (carpeta) => (await readdir(carpeta, { withFileTypes: true })).map((d) => ({ nombre: d.name, esCarpeta: d.isDirectory() })),
    leerAtajo: (ruta) => {
      try {
        const a = shell.readShortcutLink(ruta)
        return { destino: a.target ?? '', argumentos: a.args ?? '' }
      } catch {
        return null
      }
    },
    listarAppsTienda,
    leerConfiguracion: async (): Promise<ConfigApps> => {
      let texto: string
      try {
        texto = await readFile(archivoConfig, 'utf8')
      } catch {
        return { alias: {}, excluir: [] }
      }
      const { config, avisos } = leerConfigApps(texto)
      for (const a of avisos) console.warn(`[orbe] ${a}`)
      return config
    },
    existeArchivo: (ruta) =>
      access(ruta).then(
        () => true,
        () => false
      )
  }
  return {
    abrirUrl: { abrir: (url) => shell.openExternal(url) },
    catalogo: new CatalogoAplicaciones(depsCatalogo),
    lanzador: { abrirRuta, abrirTienda }
  }
}
