import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Un servidor MCP (Model Context Protocol) mínimo, por HTTP y solo en este equipo, para que el CLI de Claude use las
 * herramientas de Orbe. Es el mismo registro, la misma política y las mismas tarjetas de permiso que con los demás
 * proveedores: aquí solo se traduce el protocolo. No guarda sesiones ni manda nada por su cuenta (solo responde).
 */

export interface HerramientaMcp {
  name: string
  description: string
  inputSchema: unknown
}

export interface RespuestaHerramienta {
  texto: string
  esError: boolean
}

export interface ManejadorMcp {
  listar(): HerramientaMcp[]
  /** `senal` se activa si el cliente cuelga a mitad de la llamada (p. ej. el usuario pulsó Detener). */
  llamar(nombre: string, argumentos: unknown, senal: AbortSignal): Promise<RespuestaHerramienta>
}

/** Versiones del protocolo que se saben hablar, de la más nueva a la más antigua. */
const VERSIONES = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const RUTA = '/mcp'
const MAX_CUERPO = 1_000_000

type Id = string | number | null
interface Peticion {
  jsonrpc?: unknown
  id?: Id
  method?: unknown
  params?: unknown
}

const ERR_PETICION = -32600
const ERR_METODO = -32601
const ERR_PARAMETROS = -32602
const ERR_ANALISIS = -32700

function igualesSeguros(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export class ServidorMcp {
  /** El secreto que el CLI debe mandar en cada petición; solo lo conoce el proceso que Orbe lanza. */
  readonly token = randomBytes(32).toString('hex')
  private servidor: Server | null = null
  private puerto = 0
  private iniciando: Promise<void> | null = null

  constructor(
    private readonly manejador: ManejadorMcp,
    private readonly info: { nombre: string; version: string } = { nombre: 'orbe', version: '1.0.0' }
  ) {}

  /** La dirección a la que se conecta el CLI; vale `null` hasta que se inicia. */
  get url(): string | null {
    return this.servidor ? `http://127.0.0.1:${this.puerto}${RUTA}` : null
  }

  /** Empieza a escuchar en un puerto libre de 127.0.0.1. Se puede llamar varias veces. */
  iniciar(): Promise<string> {
    this.iniciando ??= new Promise<void>((resolver, rechazar) => {
      const servidor = createServer((req, res) => void this.atender(req, res))
      servidor.once('error', rechazar)
      servidor.listen(0, '127.0.0.1', () => {
        this.servidor = servidor
        this.puerto = (servidor.address() as AddressInfo).port
        servidor.off('error', rechazar)
        resolver()
      })
    })
    return this.iniciando.then(() => this.url as string)
  }

  async cerrar(): Promise<void> {
    const servidor = this.servidor
    this.servidor = null
    this.iniciando = null
    if (!servidor) return
    servidor.closeAllConnections()
    await new Promise<void>((resolver) => servidor.close(() => resolver()))
  }

  // -------------------------------------------------------------------------------------------

  private permitido(req: IncomingMessage): boolean {
    // Un navegador (una página web) manda «Origin»: el CLI no. Y el nombre de host debe ser el de este equipo, no uno
    // que una página haya hecho apuntar aquí (DNS rebinding).
    if (req.headers['origin'] !== undefined) return false
    const host = (req.headers['host'] ?? '').toLowerCase()
    if (!(host === `127.0.0.1:${this.puerto}` || host === `localhost:${this.puerto}` || host === `[::1]:${this.puerto}`)) return false
    const autorizacion = req.headers['authorization']
    return typeof autorizacion === 'string' && igualesSeguros(autorizacion, `Bearer ${this.token}`)
  }

  private async atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const terminar = (estado: number, cuerpo?: unknown, cabeceras: Record<string, string> = {}): void => {
      if (res.headersSent) return
      res.writeHead(estado, cuerpo === undefined ? cabeceras : { 'content-type': 'application/json', ...cabeceras })
      res.end(cuerpo === undefined ? undefined : JSON.stringify(cuerpo))
    }
    if (!this.permitido(req)) return terminar(401)
    if ((req.url ?? '').split('?')[0] !== RUTA) return terminar(404)
    // El protocolo permite que un servidor no ofrezca el canal de eventos (GET): este solo responde a peticiones.
    if (req.method !== 'POST') return terminar(405, undefined, { allow: 'POST' })

    let texto: string
    try {
      texto = await leerCuerpo(req)
    } catch {
      return terminar(413)
    }
    let mensaje: Peticion
    try {
      mensaje = JSON.parse(texto) as Peticion
    } catch {
      return terminar(400, error(null, ERR_ANALISIS, 'JSON no válido.'))
    }
    if (typeof mensaje !== 'object' || mensaje === null || Array.isArray(mensaje) || typeof mensaje.method !== 'string') {
      return terminar(400, error(null, ERR_PETICION, 'Petición no válida.'))
    }

    // Sin «id» es una notificación: se acepta y no se contesta.
    if (mensaje.id === undefined) return terminar(202)
    const id = mensaje.id

    // Si el cliente cuelga a mitad de una llamada, la herramienta se entera.
    const cancelacion = new AbortController()
    res.once('close', () => {
      if (!res.writableFinished) cancelacion.abort()
    })
    try {
      terminar(200, await this.responder(id, mensaje.method, mensaje.params, cancelacion.signal))
    } catch (e) {
      terminar(200, error(id, -32603, e instanceof Error ? e.message : 'Error interno.'))
    }
  }

  private async responder(id: Id, metodo: string, params: unknown, senal: AbortSignal): Promise<unknown> {
    const p = (typeof params === 'object' && params !== null ? params : {}) as Record<string, unknown>
    switch (metodo) {
      case 'initialize': {
        const pedida = typeof p['protocolVersion'] === 'string' ? p['protocolVersion'] : ''
        return resultado(id, {
          protocolVersion: VERSIONES.includes(pedida) ? pedida : VERSIONES[0],
          capabilities: { tools: {} },
          serverInfo: { name: this.info.nombre, version: this.info.version }
        })
      }
      case 'ping':
        return resultado(id, {})
      case 'tools/list':
        return resultado(id, { tools: this.manejador.listar() })
      case 'tools/call': {
        const nombre = p['name']
        if (typeof nombre !== 'string' || nombre === '') return error(id, ERR_PARAMETROS, 'Falta el nombre de la herramienta.')
        if (!this.manejador.listar().some((h) => h.name === nombre)) return error(id, ERR_PARAMETROS, `No existe la herramienta «${nombre}».`)
        let r: RespuestaHerramienta
        try {
          r = await this.manejador.llamar(nombre, p['arguments'], senal)
        } catch (e) {
          // Un fallo de la herramienta se cuenta como resultado con error, que es lo que el modelo sabe leer.
          r = { texto: `Error: ${e instanceof Error ? e.message : String(e)}`, esError: true }
        }
        return resultado(id, { content: [{ type: 'text', text: r.texto }], isError: r.esError })
      }
      default:
        // Incluye «server/discover» y otros métodos más nuevos: el cliente vuelve al protocolo de siempre.
        return error(id, ERR_METODO, `No conozco el método «${metodo}».`)
    }
  }
}

function resultado(id: Id, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result }
}

function error(id: Id, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const trozos: Buffer[] = []
    let total = 0
    req.on('data', (t: Buffer) => {
      total += t.length
      if (total > MAX_CUERPO) {
        rechazar(new Error('demasiado grande'))
        req.destroy()
        return
      }
      trozos.push(t)
    })
    req.on('end', () => resolver(Buffer.concat(trozos).toString('utf8')))
    req.on('error', rechazar)
  })
}
