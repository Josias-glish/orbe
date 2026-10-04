import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { MotivoFin } from '../../shared/tipos'
import { construirBloques, type TurnoEntrada } from './contenido'
import { ErrorChat, crearError, errorDesdeCli, type InfoErrorCli } from './errores'
import { LectorLineas, interpretarLinea, type EventoCli } from './parseador-stream'
import { PROMPT_SISTEMA } from './prompt-sistema'
import type { Esfuerzo, ManejadoresTurno, ProveedorChat, ResultadoTurno } from './proveedor'

/** Cómo se lanza el proceso; se puede sustituir en las pruebas por un CLI de mentira. */
export type Lanzador = (args: string[], opciones: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess

export interface OpcionesProveedorCli {
  modelo: string
  esfuerzo: Esfuerzo
  /** Carpeta de trabajo del CLI: debe estar vacía para que no cargue ningún CLAUDE.md. */
  directorioTrabajo: string
  /** Ruta de claude.exe; si falta se busca con `where claude`. */
  rutaCli?: string
  lanzador?: Lanzador
  /** Reintentos de conexión que se toleran antes de dar el turno por fallido. */
  reintentosMax?: number
  /** Silencio máximo (sin ninguna salida del CLI) durante un turno. */
  silencioMaxMs?: number
  /** Tiempo que se espera a que el CLI confirme una interrupción antes de matarlo. */
  esperaInterrupcionMs?: number
}

const VARIABLES_QUE_CAMBIAN_DE_CUENTA = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']

/** Argumentos del CLI: un chat puro, sin herramientas, sin ajustes del usuario y sin persistencia. */
export function argumentosCli(modelo: string, esfuerzo: Esfuerzo): string[] {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--model', modelo,
    '--effort', esfuerzo,
    '--tools', '',
    '--system-prompt', PROMPT_SISTEMA,
    '--setting-sources', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--disable-slash-commands'
  ]
}

/**
 * Busca claude.exe. Con npm, `where claude` devuelve un .cmd; el ejecutable real está en
 * node_modules/@anthropic-ai/claude-code/bin junto a él. Se lanza el .exe directamente para no
 * depender de un shell.
 */
export function buscarRutaCli(
  salidaWhere: string[],
  existe: (ruta: string) => boolean = existsSync,
  entorno: NodeJS.ProcessEnv = process.env
): string | null {
  for (const candidata of salidaWhere) {
    if (/\.exe$/i.test(candidata) && existe(candidata)) return candidata
    const junto = join(dirname(candidata), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    if (existe(junto)) return junto
  }
  const inicio = entorno['USERPROFILE']
  if (inicio) {
    const nativa = join(inicio, '.local', 'bin', 'claude.exe')
    if (existe(nativa)) return nativa
  }
  return null
}

function resolverRutaCli(rutaConfigurada?: string): string | null {
  if (rutaConfigurada) {
    if (/\.exe$/i.test(rutaConfigurada)) return existsSync(rutaConfigurada) ? rutaConfigurada : null
    // Si apuntan al shim (.cmd/.ps1), buscamos el .exe que hay a su lado.
    return buscarRutaCli([rutaConfigurada])
  }
  let salida: string[] = []
  try {
    salida = execFileSync('where', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    // `where` falla si no hay ninguna coincidencia.
  }
  return buscarRutaCli(salida)
}

interface TurnoActivo {
  manejadores: ManejadoresTurno
  resolver: (r: ResultadoTurno) => void
  rechazar: (e: ErrorChat) => void
  huboDeltas: boolean
  hayTexto: boolean
  cancelando: boolean
  /** Error decidido por nosotros (sin conexión, silencio) que sustituye al resultado del CLI. */
  errorForzado: ErrorChat | null
  errorCli: { codigo: string; texto: string } | null
  temporizadorSilencio: NodeJS.Timeout | null
  temporizadorInterrupcion: NodeJS.Timeout | null
}

/**
 * Habla con Claude a través del CLI instalado (usa tu sesión de Claude, sin API key). Mantiene un
 * único proceso `claude -p` por conversación: el propio CLI guarda el contexto entre turnos.
 */
export class ProveedorCli implements ProveedorChat {
  readonly nombre = 'cli' as const
  readonly modelo: string

  private hijo: ChildProcess | null = null
  private readonly lector = new LectorLineas()
  private turno: TurnoActivo | null = null
  private stderrFinal = ''
  private turnosCompletados = 0
  private contextoPerdido = false
  private cierreEsperado = false
  private contadorControl = 0
  private limite: { estado: string; reinicioSeg: number | null } | null = null

  private readonly reintentosMax: number
  private readonly silencioMaxMs: number
  private readonly esperaInterrupcionMs: number

  constructor(private readonly opciones: OpcionesProveedorCli) {
    this.modelo = opciones.modelo
    this.reintentosMax = opciones.reintentosMax ?? 3
    this.silencioMaxMs = opciones.silencioMaxMs ?? 120_000
    this.esperaInterrupcionMs = opciones.esperaInterrupcionMs ?? 4000
  }

  precalentar(): void {
    if (this.hijo || this.turno) return
    try {
      this.asegurarProceso()
    } catch {
      // Si falla, el error se mostrará al enviar el primer mensaje.
    }
  }

  enviar(entrada: TurnoEntrada, manejadores: ManejadoresTurno): Promise<ResultadoTurno> {
    if (this.turno) {
      return Promise.reject(
        new ErrorChat(crearError('solicitud_invalida', { mensaje: 'Todavía estoy respondiendo al mensaje anterior.' }))
      )
    }

    let hijo: ChildProcess
    try {
      hijo = this.asegurarProceso()
    } catch (e) {
      return Promise.reject(e)
    }

    return new Promise<ResultadoTurno>((resolver, rechazar) => {
      const turno: TurnoActivo = {
        manejadores,
        resolver,
        rechazar,
        huboDeltas: false,
        hayTexto: false,
        cancelando: false,
        errorForzado: null,
        errorCli: null,
        temporizadorSilencio: null,
        temporizadorInterrupcion: null
      }
      this.turno = turno
      this.limite = null
      this.armarSilencio(turno)

      if (this.contextoPerdido) {
        this.contextoPerdido = false
        manejadores.alAviso?.('La sesión con Claude se reinició y ha olvidado lo anterior de esta conversación.')
      }

      const linea = JSON.stringify({ type: 'user', message: { role: 'user', content: construirBloques(entrada) } })
      hijo.stdin?.write(linea + '\n', (error) => {
        if (error && this.turno === turno) {
          this.cerrarTurnoConError(
            turno,
            new ErrorChat(crearError('desconocido', { mensaje: 'No he podido enviar el mensaje al CLI de Claude.', detalle: error.message }))
          )
        }
      })
    })
  }

  cancelar(): void {
    const turno = this.turno
    if (!turno || turno.cancelando) return
    turno.cancelando = true
    this.interrumpir(turno)
  }

  reiniciar(): void {
    this.terminarProceso()
    this.turnosCompletados = 0
    this.contextoPerdido = false
  }

  cerrar(): void {
    this.terminarProceso()
  }

  // -------------------------------------------------------------------------------------------

  private asegurarProceso(): ChildProcess {
    if (this.hijo) return this.hijo

    const lanzador = this.opciones.lanzador ?? this.lanzadorReal()
    mkdirSync(this.opciones.directorioTrabajo, { recursive: true })

    // El CLI usa la sesión de Claude; si hubiera una API key suelta en el entorno, cobraría por ahí.
    const env = { ...process.env }
    for (const variable of VARIABLES_QUE_CAMBIAN_DE_CUENTA) delete env[variable]

    const hijo = lanzador(argumentosCli(this.opciones.modelo, this.opciones.esfuerzo), {
      cwd: this.opciones.directorioTrabajo,
      env
    })
    this.hijo = hijo
    this.cierreEsperado = false
    this.stderrFinal = ''
    this.lector.reiniciar()

    hijo.stdout?.setEncoding('utf8')
    hijo.stdout?.on('data', (trozo: string) => this.alRecibirDatos(hijo, trozo))
    hijo.stderr?.setEncoding('utf8')
    hijo.stderr?.on('data', (trozo: string) => {
      this.stderrFinal = (this.stderrFinal + trozo).slice(-4000)
    })
    hijo.stdin?.on('error', () => {
      // EPIPE si el proceso ya murió: lo gestiona el evento 'exit'.
    })
    hijo.on('error', (error: NodeJS.ErrnoException) => this.alFallarElLanzamiento(hijo, error))
    hijo.on('exit', (codigo, senal) => this.alSalir(hijo, codigo, senal))
    return hijo
  }

  private lanzadorReal(): Lanzador {
    const ruta = resolverRutaCli(this.opciones.rutaCli)
    if (!ruta) throw new ErrorChat(crearError('cli_no_encontrado'))
    return (args, { cwd, env }) =>
      spawn(ruta, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  }

  private alRecibirDatos(hijo: ChildProcess, trozo: string): void {
    if (hijo !== this.hijo) return
    if (this.turno) this.armarSilencio(this.turno)
    for (const linea of this.lector.alimentar(trozo)) {
      for (const evento of interpretarLinea(linea)) this.manejarEvento(evento)
    }
  }

  private manejarEvento(evento: EventoCli): void {
    if (evento.k === 'limite') {
      this.limite = { estado: evento.estado, reinicioSeg: evento.reinicioSeg }
      return
    }
    const turno = this.turno
    if (!turno) return

    switch (evento.k) {
      case 'texto':
        turno.huboDeltas = true
        turno.hayTexto = true
        turno.manejadores.alTexto(evento.delta)
        break
      case 'mensaje_completo':
        // Respaldo: solo si no llegaron deltas durante el turno.
        if (!turno.huboDeltas) {
          turno.hayTexto = true
          turno.manejadores.alTexto(evento.texto)
        }
        break
      case 'error_mensaje':
        turno.errorCli = { codigo: evento.codigo, texto: evento.texto }
        break
      case 'reintento':
        this.alReintentar(turno, evento)
        break
      case 'resultado':
        this.alTerminarTurno(turno, evento)
        break
      default:
        break
    }
  }

  /**
   * El CLI reintenta hasta 10 veces con esperas de hasta 40 s. Para un asistente de escritorio eso
   * es una eternidad: tras unos pocos intentos damos el turno por fallido y lo decimos claramente.
   */
  private alReintentar(turno: TurnoActivo, e: Extract<EventoCli, { k: 'reintento' }>): void {
    turno.manejadores.alReintento?.(e.intento, this.reintentosMax)
    if (e.intento < this.reintentosMax || turno.errorForzado || turno.cancelando) return

    // Sin estado HTTP no hubo respuesta del servidor: es un problema de conexión.
    const detalle = `${e.intento} intentos fallidos (${e.error})`
    turno.errorForzado = new ErrorChat(
      e.estadoHttp === null
        ? crearError('sin_conexion', { detalle })
        : errorDesdeCli({ estadoHttp: e.estadoHttp, reinicioSeg: this.limite?.reinicioSeg, texto: detalle })
    )
    this.interrumpir(turno)
  }

  private alTerminarTurno(turno: TurnoActivo, r: Extract<EventoCli, { k: 'resultado' }>): void {
    if (turno.errorForzado) {
      this.cerrarTurnoConError(turno, turno.errorForzado)
      return
    }
    if (r.error) {
      if (turno.cancelando) {
        this.cerrarTurnoOk(turno, 'cancelado')
        return
      }
      const info: InfoErrorCli = {
        codigoCli: turno.errorCli?.codigo,
        estadoHttp: r.estadoHttp,
        texto: turno.errorCli?.texto || r.texto,
        reinicioSeg: this.limite?.reinicioSeg,
        limiteRechazado: this.limite?.estado === 'rejected',
        stderr: this.stderrFinal
      }
      this.cerrarTurnoConError(turno, new ErrorChat(errorDesdeCli(info)))
      return
    }
    if (r.parada === 'refusal') {
      this.cerrarTurnoConError(turno, new ErrorChat(crearError('rechazo')))
      return
    }
    const motivo: MotivoFin = turno.cancelando ? 'cancelado' : r.parada === 'max_tokens' ? 'limite_tokens' : 'completo'
    this.cerrarTurnoOk(turno, motivo)
  }

  private cerrarTurnoOk(turno: TurnoActivo, motivo: MotivoFin): void {
    this.limpiarTurno(turno)
    if (motivo !== 'cancelado') this.turnosCompletados++
    turno.resolver({ motivo })
  }

  private cerrarTurnoConError(turno: TurnoActivo, error: ErrorChat): void {
    this.limpiarTurno(turno)
    turno.rechazar(error)
  }

  private limpiarTurno(turno: TurnoActivo): void {
    if (turno.temporizadorSilencio) clearTimeout(turno.temporizadorSilencio)
    if (turno.temporizadorInterrupcion) clearTimeout(turno.temporizadorInterrupcion)
    if (this.turno === turno) this.turno = null
  }

  private armarSilencio(turno: TurnoActivo): void {
    if (turno.temporizadorSilencio) clearTimeout(turno.temporizadorSilencio)
    turno.temporizadorSilencio = setTimeout(() => {
      if (this.turno !== turno || turno.errorForzado) return
      turno.errorForzado = new ErrorChat(
        crearError('tiempo_agotado', { detalle: `Sin respuesta del CLI durante ${Math.round(this.silencioMaxMs / 1000)} s` })
      )
      this.interrumpir(turno)
    }, this.silencioMaxMs)
  }

  /** Pide al CLI que corte la generación; si no contesta a tiempo, se mata el proceso. */
  private interrumpir(turno: TurnoActivo): void {
    if (turno.temporizadorInterrupcion) return
    const solicitud = { type: 'control_request', request_id: `orbe-${++this.contadorControl}`, request: { subtype: 'interrupt' } }
    this.hijo?.stdin?.write(JSON.stringify(solicitud) + '\n')
    turno.temporizadorInterrupcion = setTimeout(() => {
      if (this.turno === turno) this.hijo?.kill()
    }, this.esperaInterrupcionMs)
  }

  private alFallarElLanzamiento(hijo: ChildProcess, error: NodeJS.ErrnoException): void {
    if (hijo !== this.hijo) return
    this.hijo = null
    const turno = this.turno
    if (!turno) return
    const codigo = error.code === 'ENOENT' ? 'cli_no_encontrado' : 'desconocido'
    this.cerrarTurnoConError(turno, new ErrorChat(crearError(codigo, { detalle: error.message })))
  }

  private alSalir(hijo: ChildProcess, codigo: number | null, senal: NodeJS.Signals | null): void {
    if (hijo !== this.hijo) return
    this.hijo = null
    this.lector.reiniciar()

    // Salir tras un fallo de sesión es normal: solo se pierde contexto si ya había conversación.
    if (!this.cierreEsperado && this.turnosCompletados > 0) this.contextoPerdido = true

    const turno = this.turno
    if (!turno) return
    if (turno.errorForzado) {
      this.cerrarTurnoConError(turno, turno.errorForzado)
    } else if (turno.cancelando) {
      this.cerrarTurnoOk(turno, 'cancelado')
    } else if (turno.errorCli) {
      this.cerrarTurnoConError(
        turno,
        new ErrorChat(errorDesdeCli({ codigoCli: turno.errorCli.codigo, texto: turno.errorCli.texto, stderr: this.stderrFinal }))
      )
    } else {
      const como = senal ? `señal ${senal}` : `código ${codigo}`
      this.cerrarTurnoConError(
        turno,
        new ErrorChat(
          crearError('desconocido', {
            mensaje: 'El CLI de Claude se ha cerrado de forma inesperada.',
            detalle: `${como}${this.stderrFinal ? ` · ${this.stderrFinal.trim().slice(-400)}` : ''}`
          })
        )
      )
    }
  }

  /** Cierra el proceso sin considerarlo un fallo (nueva conversación, salir de la app). */
  private terminarProceso(): void {
    const hijo = this.hijo
    this.cierreEsperado = true
    const turno = this.turno
    if (turno) this.cerrarTurnoOk(turno, 'cancelado')
    this.hijo = null
    if (hijo) {
      hijo.removeAllListeners('exit')
      try {
        hijo.stdin?.end()
      } catch {
        // ya cerrado
      }
      hijo.kill()
    }
  }
}
