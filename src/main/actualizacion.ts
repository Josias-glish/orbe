import { execFile, spawn } from 'node:child_process'
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
   * Windows: el instalador en silencio, que vuelve a abrir Orbe (`--force-run`). Sin `/allusers`: en el PC del usuario
   * (15-nov) el instalador eligió él solo dónde instalar sin hacerle caso, y la copia que sobre la quita
   * `borrarCopiasAntiguas` al arrancar la nueva. Devuelve true si hay que salir para dejarle instalar.
   * macOS: abre el .dmg para arrastrarlo a Aplicaciones.
   */
  instalar(abrir: (ruta: string) => void, lanzar: typeof spawn = spawn): boolean {
    if (this.actual.fase !== 'lista' || !this.archivo || !existsSync(this.archivo)) return false
    if (this.d.plataforma === 'darwin') {
      abrir(this.archivo)
      return false
    }
    lanzar(this.archivo, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
    return true
  }
}

/**
 * La clave de desinstalación de Orbe: electron-builder la deriva del appId y es la misma para la copia «solo para mí»
 * (HKCU) y la de «todos los usuarios» (HKLM). Comprobado en el registro del usuario el 15-nov.
 */
const CLAVE_DESINSTALAR = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\f1db034b-5259-5a30-bd19-fdf7c3750484'

export interface CopiaInstalada {
  todos: boolean
  version: string
  /** QuietUninstallString: `"…\Uninstall Orbe.exe" /allusers /S`. */
  desinstalar: string
}

/** Lee la salida de `reg query` de una clave de desinstalación. */
export function leerCopia(salida: string, todos: boolean): CopiaInstalada | null {
  const valor = (n: string): string => new RegExp(`^\\s+${n}\\s+REG_\\w+\\s+(.*?)\\s*$`, 'm').exec(salida)?.[1] ?? ''
  const version = valor('DisplayVersion')
  const desinstalar = valor('QuietUninstallString')
  return /^\d+\.\d+\.\d+$/.test(version) && desinstalar ? { todos, version, desinstalar } : null
}

/** El ejecutable y sus argumentos de `"C:\…\Uninstall Orbe.exe" /allusers /S`. */
export function partirOrden(orden: string): { exe: string; args: string[] } | null {
  const m = /^"([^"]+\.exe)"\s*(.*)$/i.exec(orden.trim())
  return m ? { exe: m[1]!, args: m[2]!.split(/\s+/).filter(Boolean) } : null
}

/** Las copias que sobran: más antiguas que la que corre y en otra carpeta (nunca la propia ni una más nueva). */
export function copiasAntiguas(copias: CopiaInstalada[], versionActual: string, carpetaActual: string): CopiaInstalada[] {
  const propia = carpetaActual.toLowerCase().replace(/[\\/]+$/, '')
  return copias.filter((c) => {
    const exe = partirOrden(c.desinstalar)?.exe.toLowerCase() ?? ''
    return compararVersiones(c.version, versionActual) < 0 && exe !== '' && !exe.startsWith(`${propia}\\`) && !exe.startsWith(`${propia}/`)
  })
}

export interface DepsLimpieza {
  versionActual: string
  /** Carpeta de la copia que corre (la de process.execPath). */
  carpetaActual: string
  /** `reg query` de la clave en HKCU o HKLM; null si no existe. */
  leerRegistro(raiz: 'HKCU' | 'HKLM'): Promise<string | null>
  /** Lanza el desinstalador silencioso; con `admin`, por UAC (la copia de todos los usuarios lo necesita). */
  desinstalar(exe: string, args: string[], admin: boolean): void
  avisar(version: string, admin: boolean): void
}

/**
 * Al arrancar una versión nueva, quita la anterior si quedó instalada en el otro sitio (todos los usuarios frente a solo
 * para ti): el instalador de electron-builder solo sustituye la de su mismo sitio. Su desinstalador solo cierra los
 * procesos de su carpeta (allowOnlyOneInstallerInstance.nsh, línea 94), así que la copia nueva sigue abierta. No toca
 * %APPDATA%/orbe (deleteAppDataOnUninstall: false).
 */
export async function borrarCopiasAntiguas(d: DepsLimpieza): Promise<CopiaInstalada[]> {
  const copias: CopiaInstalada[] = []
  for (const raiz of ['HKCU', 'HKLM'] as const) {
    const salida = await d.leerRegistro(raiz).catch(() => null)
    const c = salida ? leerCopia(salida, raiz === 'HKLM') : null
    if (c) copias.push(c)
  }
  const sobran = copiasAntiguas(copias, d.versionActual, d.carpetaActual)
  for (const c of sobran) {
    const orden = partirOrden(c.desinstalar)
    if (!orden) continue
    d.avisar(c.version, c.todos)
    d.desinstalar(orden.exe, orden.args, c.todos)
  }
  return sobran
}

/** `reg query` de la clave de Orbe (null si no existe). */
export function leerRegistroOrbe(raiz: 'HKCU' | 'HKLM'): Promise<string | null> {
  return new Promise((resolver) => {
    execFile('reg', ['query', `${raiz}\\${CLAVE_DESINSTALAR}`], { windowsHide: true, timeout: 10_000 }, (error, salida) =>
      resolver(error ? null : salida)
    )
  })
}

/** El desinstalador en silencio; la copia de todos los usuarios, con el permiso de administrador de Windows (UAC). */
export function lanzarDesinstalador(exe: string, args: string[], admin: boolean): void {
  if (!admin) {
    spawn(exe, args, { detached: true, stdio: 'ignore' }).unref()
    return
  }
  const cita = (t: string): string => `'${t.replace(/'/g, "''")}'`
  const ps = `Start-Process -FilePath ${cita(exe)} -ArgumentList ${args.map(cita).join(',')} -Verb RunAs`
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

/** La cabecera del chat pregunta el estado, recibe los cambios y pide instalar. */
export function registrarActualizacion(ventana: BrowserWindow, act: Actualizador, instalar: () => void): void {
  const propia = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean => e.sender === ventana.webContents
  ipcMain.handle(CANALES.actualizacionEstado, (e) => (propia(e) ? act.estado : { fase: 'nada' }))
  ipcMain.on(CANALES.actualizacionInstalar, (e) => {
    if (propia(e)) instalar()
  })
}
