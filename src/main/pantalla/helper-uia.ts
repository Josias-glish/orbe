import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'

/** Fallo del lector de pantalla (UI Automation), con un mensaje apto para mostrar en los detalles técnicos. */
export class ErrorHelper extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorHelper'
  }
}

/** Cómo se lanza el helper; se puede sustituir en las pruebas por uno de mentira. */
export type LanzadorHelper = (args: { pidOrbe: number; cacheDir: string }) => ChildProcess

export interface OpcionesHelper {
  pidOrbe: number
  /** Carpeta donde el helper guarda su DLL compilada. */
  cacheDir: string
  /** Carpeta con uia-helper.ps1 y UiaHelper.cs (obligatoria salvo que se pase un lanzador). */
  carpetaHelper?: string
  lanzador?: LanzadorHelper
  /** Máximo para que el helper diga que está listo (la primera vez compila C#). */
  arranqueMaxMs?: number
}

interface Pendiente {
  resolver: (datos: unknown) => void
  rechazar: (e: ErrorHelper) => void
  temporizador: NodeJS.Timeout
}

interface MensajeHelper {
  tipo?: string
  mensaje?: string
  id?: number
  ok?: boolean
  datos?: unknown
  error?: string
}

/** Lanza el PowerShell que ejecuta UiaHelper.cs. Se usa la ruta absoluta para no depender del PATH. */
export function lanzadorPowerShell(carpetaHelper: string): LanzadorHelper {
  const ps = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return ({ pidOrbe, cacheDir }) =>
    spawn(
      ps,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', join(carpetaHelper, 'uia-helper.ps1'),
        '-PidOrbe', String(pidOrbe),
        '-CacheDir', cacheDir
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    )
}

/**
 * Cliente del lector de pantalla: un proceso PowerShell persistente que habla JSON por líneas.
 * Si el proceso muere, se vuelve a lanzar en la siguiente petición.
 */
export class ClienteHelper {
  private hijo: ChildProcess | null = null
  private arranque: Promise<void> | null = null
  private readonly pendientes = new Map<number, Pendiente>()
  private contador = 0
  private buffer = ''
  private stderrFinal = ''
  private cerrando = false

  private readonly arranqueMaxMs: number

  constructor(private readonly opciones: OpcionesHelper) {
    this.arranqueMaxMs = opciones.arranqueMaxMs ?? 25_000
  }

  /** Lo arranca en segundo plano (no lanza si falla: el error saldrá en la primera petición). */
  precalentar(): void {
    void this.asegurarListo().catch(() => undefined)
  }

  /** Resuelve cuando el helper dice que está listo; si no está arrancado, lo arranca. */
  asegurarListo(): Promise<void> {
    if (!this.arranque) this.arranque = this.lanzar()
    return this.arranque
  }

  private lanzar(): Promise<void> {
    return new Promise<void>((resolver, rechazar) => {
      const lanzador =
        this.opciones.lanzador ??
        (this.opciones.carpetaHelper ? lanzadorPowerShell(this.opciones.carpetaHelper) : null)
      if (!lanzador) {
        rechazar(new ErrorHelper('No se indicó dónde está el lector de pantalla.'))
        return
      }

      this.cerrando = false
      this.buffer = ''
      this.stderrFinal = ''
      let hijo: ChildProcess
      try {
        hijo = lanzador({ pidOrbe: this.opciones.pidOrbe, cacheDir: this.opciones.cacheDir })
      } catch (e) {
        rechazar(new ErrorHelper(`No se pudo iniciar el lector de pantalla: ${(e as Error).message}`))
        return
      }
      this.hijo = hijo
      let listo = false

      const temporizador = setTimeout(() => {
        if (listo) return
        rechazar(new ErrorHelper(`El lector de pantalla no arrancó en ${Math.round(this.arranqueMaxMs / 1000)} s.`))
        hijo.kill()
      }, this.arranqueMaxMs)

      hijo.stdout?.setEncoding('utf8')
      hijo.stdout?.on('data', (trozo: string) => {
        this.buffer += trozo
        let corte: number
        while ((corte = this.buffer.indexOf('\n')) >= 0) {
          const linea = this.buffer.slice(0, corte).trim()
          this.buffer = this.buffer.slice(corte + 1)
          if (!linea) continue
          let mensaje: MensajeHelper
          try {
            mensaje = JSON.parse(linea) as MensajeHelper
          } catch {
            continue // ruido de PowerShell que no es JSON
          }
          if (mensaje.tipo === 'listo') {
            listo = true
            clearTimeout(temporizador)
            resolver()
          } else if (mensaje.tipo === 'error') {
            clearTimeout(temporizador)
            rechazar(new ErrorHelper(mensaje.mensaje ?? 'Error desconocido al preparar el lector de pantalla.'))
          } else {
            this.alRespuesta(mensaje)
          }
        }
      })
      hijo.stderr?.setEncoding('utf8')
      hijo.stderr?.on('data', (trozo: string) => {
        this.stderrFinal = (this.stderrFinal + trozo).slice(-2000)
      })
      hijo.stdin?.on('error', () => undefined)
      hijo.on('error', (e) => {
        clearTimeout(temporizador)
        rechazar(new ErrorHelper(`No se pudo iniciar PowerShell: ${e.message}`))
        this.alSalir(hijo)
      })
      hijo.on('exit', (codigo) => {
        clearTimeout(temporizador)
        if (!listo) {
          const detalle = this.stderrFinal.trim() ? ` ${this.stderrFinal.trim().slice(-300)}` : ''
          rechazar(new ErrorHelper(`El lector de pantalla se cerró al arrancar (código ${codigo}).${detalle}`))
        }
        this.alSalir(hijo)
      })
    })
  }

  private alRespuesta(mensaje: MensajeHelper): void {
    if (typeof mensaje.id !== 'number') return
    const pendiente = this.pendientes.get(mensaje.id)
    if (!pendiente) return
    this.pendientes.delete(mensaje.id)
    clearTimeout(pendiente.temporizador)
    if (mensaje.ok) pendiente.resolver(mensaje.datos)
    else pendiente.rechazar(new ErrorHelper(mensaje.error ?? 'Error desconocido del lector de pantalla.'))
  }

  private alSalir(hijo: ChildProcess): void {
    if (hijo !== this.hijo) return
    this.hijo = null
    this.arranque = null
    this.buffer = ''
    const motivo = this.cerrando ? 'El lector de pantalla se cerró.' : 'El lector de pantalla se detuvo inesperadamente.'
    for (const [id, pendiente] of this.pendientes) {
      clearTimeout(pendiente.temporizador)
      pendiente.rechazar(new ErrorHelper(motivo))
      this.pendientes.delete(id)
    }
  }

  /** Envía una operación al helper y espera su respuesta. */
  async pedir<T>(op: string, parametros: Record<string, unknown> = {}, tiempoMaxMs = 8000): Promise<T> {
    await this.asegurarListo()
    const hijo = this.hijo
    if (!hijo || !hijo.stdin || hijo.stdin.destroyed) throw new ErrorHelper('El lector de pantalla no está en marcha.')

    return new Promise<T>((resolver, rechazar) => {
      const id = ++this.contador
      const temporizador = setTimeout(() => {
        this.pendientes.delete(id)
        rechazar(new ErrorHelper(`El lector de pantalla no respondió a «${op}» en ${Math.round(tiempoMaxMs / 1000)} s.`))
      }, tiempoMaxMs)
      this.pendientes.set(id, { resolver: resolver as (d: unknown) => void, rechazar, temporizador })
      hijo.stdin!.write(JSON.stringify({ id, op, ...parametros }) + '\n', (error) => {
        if (error && this.pendientes.delete(id)) {
          clearTimeout(temporizador)
          rechazar(new ErrorHelper(`No se pudo enviar la petición al lector de pantalla: ${error.message}`))
        }
      })
    })
  }

  cerrar(): void {
    this.cerrando = true
    const hijo = this.hijo
    if (!hijo) return
    try {
      hijo.stdin?.end()
    } catch {
      // ya cerrado
    }
    hijo.kill()
  }
}
