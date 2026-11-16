import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { ipcMain, type BrowserWindow } from 'electron'
import { CANALES, type EstadoActualizacion } from '../shared/tipos'

/** Las releases públicas de Orbe (las publica `release.yml`). `/releases/latest` no incluye borradores ni prereleases. */
export const URL_ULTIMA = 'https://api.github.com/repos/Josias-glish/orbe/releases/latest'

/** -1, 0 o 1, como «1.25.1» frente a «1.26.0» (sin sufijos: Orbe no publica prereleases). */
export function compararVersiones(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return Math.sign(d)
  }
  return 0
}

export interface Activo {
  nombre: string
  url: string
  tam: number
  /** SHA-256 que publica GitHub (`digest`); sin él no se descarga nada. */
  sha256: string
}

export interface Release {
  version: string
  pagina: string
  activo: Activo | null
}

/** Lo que interesa de la respuesta de GitHub: el instalador de este sistema y su huella. */
export function leerRelease(json: unknown, plataforma: NodeJS.Platform, arch: string): Release | null {
  const d = json as { tag_name?: unknown; html_url?: unknown; assets?: unknown } | null
  if (typeof d?.tag_name !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(d.tag_name) || !Array.isArray(d.assets)) return null
  const version = d.tag_name.replace(/^v/, '')
  const buscado =
    plataforma === 'darwin' ? `Orbe-${version}-mac-${arch === 'arm64' ? 'arm64' : 'x64'}.dmg` : plataforma === 'win32' ? `Orbe-Setup-${version}.exe` : ''
  const a = (d.assets as Array<Record<string, unknown>>).find((x) => x['name'] === buscado)
  const digest = a?.['digest']
  const sha = typeof digest === 'string' ? /^sha256:([0-9a-f]{64})$/.exec(digest)?.[1] : undefined
  const url = typeof a?.['browser_download_url'] === 'string' ? a['browser_download_url'] : ''
  return {
    version,
    pagina: typeof d.html_url === 'string' && d.html_url.startsWith('https://github.com/') ? d.html_url : 'https://github.com/Josias-glish/orbe/releases/latest',
    // Solo se descarga de GitHub y con huella: si falta algo, se avisa sin descargar.
    activo: sha && url.startsWith('https://github.com/') ? { nombre: buscado, url, tam: Number(a?.['size']) || 0, sha256: sha } : null
  }
}

export interface DepsActualizador {
  versionActual: string
  plataforma: NodeJS.Platform
  arch: string
  /** La versión portable no se instala: solo se avisa con el enlace. */
  portable: boolean
  /** Carpeta temporal para la descarga. */
  carpeta: string
  emitir(estado: EstadoActualizacion): void
  /** Notificación del sistema cuando está lista (para cuando el panel está cerrado). */
  avisar(version: string): void
  pedir?: typeof fetch
}

/**
 * Busca versión nueva en GitHub, la descarga sola (comprobando su SHA-256) y la instala solo cuando el usuario lo pide.
 * Nunca deja ni ejecuta un archivo cuya huella no coincida.
 */
export class Actualizador {
  private actual: EstadoActualizacion = { fase: 'nada' }
  private archivo: string | null = null
  private ocupado = false

  constructor(private readonly d: DepsActualizador) {}

  get estado(): EstadoActualizacion {
    return this.actual
  }

  private fijar(e: EstadoActualizacion): void {
    this.actual = e
    this.d.emitir(e)
  }

  async comprobar(): Promise<void> {
    if (this.ocupado || this.actual.fase === 'lista') return
    this.ocupado = true
    try {
      const r = await (this.d.pedir ?? fetch)(URL_ULTIMA, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'Orbe-actualizador' },
        signal: AbortSignal.timeout(15_000)
      })
      if (!r.ok) throw new Error(`GitHub respondió ${r.status}`)
      const rel = leerRelease(await r.json(), this.d.plataforma, this.d.arch)
      if (!rel || compararVersiones(rel.version, this.d.versionActual) <= 0) return
      if (this.d.portable || !rel.activo) {
        this.fijar({ fase: 'aviso', version: rel.version, pagina: rel.pagina })
        return
      }
      await this.descargar(rel.version, rel.activo)
    } catch (e) {
      // Sin red o GitHub caído: se reintenta en la próxima vuelta, sin molestar.
      console.warn('[actualizacion]', e instanceof Error ? e.message : e)
      if (this.actual.fase === 'descargando') this.fijar({ fase: 'nada' })
    } finally {
      this.ocupado = false
    }
  }

  private async descargar(version: string, a: Activo): Promise<void> {
    mkdirSync(this.d.carpeta, { recursive: true })
    const destino = join(this.d.carpeta, a.nombre)
    // Ya bajada en un arranque anterior y con la huella buena: no se vuelve a descargar.
    if (existsSync(destino) && createHash('sha256').update(readFileSync(destino)).digest('hex') === a.sha256) return this.lista(version, destino)
    this.fijar({ fase: 'descargando', version, progreso: 0 })
    const r = await (this.d.pedir ?? fetch)(a.url, { headers: { 'user-agent': 'Orbe-actualizador' }, signal: AbortSignal.timeout(30 * 60_000) })
    if (!r.ok || !r.body) throw new Error(`La descarga respondió ${r.status}`)
    const hash = createHash('sha256')
    const salida = createWriteStream(destino)
    let bajado = 0
    let ultimo = 0
    try {
      for await (const trozo of Readable.fromWeb(r.body as ReadableStream<Uint8Array>)) {
        const bytes = trozo as Uint8Array
        hash.update(bytes)
        bajado += bytes.length
        if (!salida.write(bytes)) await new Promise<void>((ok) => salida.once('drain', () => ok()))
        const progreso = a.tam ? Math.min(99, Math.floor((bajado / a.tam) * 100)) : 0
        if (progreso >= ultimo + 5) this.fijar({ fase: 'descargando', version, progreso: (ultimo = progreso) })
      }
    } finally {
      await new Promise<void>((ok) => salida.end(() => ok()))
    }
    if (hash.digest('hex') !== a.sha256) {
      rmSync(destino, { force: true })
      throw new Error('La huella SHA-256 de la descarga no coincide con la de GitHub: se descartó.')
    }
    this.lista(version, destino)
  }

  private lista(version: string, destino: string): void {
    this.archivo = destino
    this.fijar({ fase: 'lista', version })
    this.d.avisar(version)
  }

  /**
   * Windows: el instalador en silencio, que vuelve a abrir Orbe (`--force-run`); si Orbe está en Archivos de programa,
   * para todos los usuarios (pide permiso de administrador). Devuelve true si hay que salir para dejarle instalar.
   * macOS: abre el .dmg para arrastrarlo a Aplicaciones.
   */
  instalar(abrir: (ruta: string) => void, rutaApp: string, lanzar: typeof spawn = spawn): boolean {
    if (this.actual.fase !== 'lista' || !this.archivo || !existsSync(this.archivo)) return false
    if (this.d.plataforma === 'darwin') {
      abrir(this.archivo)
      return false
    }
    const todos = /[\\/]program files( \(x86\))?[\\/]/i.test(rutaApp)
    lanzar(this.archivo, ['/S', '--force-run', ...(todos ? ['/allusers'] : [])], { detached: true, stdio: 'ignore' }).unref()
    return true
  }
}

/** La cabecera del chat pregunta el estado, recibe los cambios y pide instalar. */
export function registrarActualizacion(ventana: BrowserWindow, act: Actualizador, instalar: () => void): void {
  const propia = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean => e.sender === ventana.webContents
  ipcMain.handle(CANALES.actualizacionEstado, (e) => (propia(e) ? act.estado : { fase: 'nada' }))
  ipcMain.on(CANALES.actualizacionInstalar, (e) => {
    if (propia(e)) instalar()
  })
}
