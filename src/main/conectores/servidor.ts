import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { EventoActividad } from '../../shared/tipos'
import { normalizarEvento, type BusActividad } from './actividad'
import { deClaudeCode } from './claude-code'

export const PUERTO_EVENTOS_POR_DEFECTO = 47821
const CUERPO_MAX = 64 * 1024
/** Como mucho tantos eventos por segundo (un bucle desbocado no inunda la interfaz). */
const RAFAGA = 30

export interface DatosConexion {
  puerto: number
  token: string
}

/**
 * El receptor local de avisos: una dirección en 127.0.0.1 (nunca accesible desde fuera del equipo) a la que Claude
 * Code (por sus hooks), n8n, un script o cualquier herramienta puede mandar «empecé», «te necesito», «terminé»…
 * para que el personaje lo muestre. Cada petición lleva un token secreto que solo está en tu carpeta de datos.
 * No ejecuta nada ni da acceso a Orbe: solo recibe avisos de texto.
 *
 *   POST /v1/eventos      { "titulo": "Copia lista", "tipo": "terminado", "origen": "backup", "detalle": "…" }
 *   POST /v1/claude-code  el JSON que Claude Code pasa a sus hooks
 *   GET  /v1/estado       comprueba que Orbe escucha
 */
export class ServidorEventos {
  private servidor: Server | null = null
  private ventanaRafaga = { inicio: 0, cuenta: 0 }

  constructor(
    private readonly bus: BusActividad,
    readonly token = randomBytes(24).toString('base64url')
  ) {}

  async iniciar(puerto = PUERTO_EVENTOS_POR_DEFECTO): Promise<DatosConexion> {
    const servidor = createServer((req, res) => void this.atender(req, res))
    servidor.requestTimeout = 5000
    servidor.headersTimeout = 5000
    await new Promise<void>((resolver, rechazar) => {
      servidor.once('error', rechazar)
      servidor.listen(puerto, '127.0.0.1', () => {
        servidor.off('error', rechazar)
        resolver()
      })
    })
    this.servidor = servidor
    return { puerto: (servidor.address() as AddressInfo).port, token: this.token }
  }

  detener(): void {
    this.servidor?.close()
    this.servidor = null
  }

  private autorizado(req: IncomingMessage): boolean {
    const cabecera = req.headers['authorization']
    const dado = typeof cabecera === 'string' && cabecera.startsWith('Bearer ') ? cabecera.slice(7) : String(req.headers['x-orbe-token'] ?? '')
    const a = Buffer.from(dado)
    const b = Buffer.from(this.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  /** Solo peticiones locales de programas, no de páginas web: sin Origin y con un Host de este equipo. */
  private local(req: IncomingMessage): boolean {
    if (req.headers['origin']) return false
    const host = String(req.headers['host'] ?? '').replace(/:\d+$/, '')
    return host === '127.0.0.1' || host === 'localhost'
  }

  private responder(res: ServerResponse, codigo: number, cuerpo?: Record<string, unknown>): void {
    res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(cuerpo ? JSON.stringify(cuerpo) : undefined)
  }

  private dentroDeRafaga(): boolean {
    const ahora = Date.now()
    if (ahora - this.ventanaRafaga.inicio > 1000) this.ventanaRafaga = { inicio: ahora, cuenta: 0 }
    return ++this.ventanaRafaga.cuenta <= RAFAGA
  }

  private async atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!this.local(req)) return this.responder(res, 403, { error: 'Solo desde este equipo.' })
      if (!this.autorizado(req)) return this.responder(res, 401, { error: 'Falta el token de Orbe o no es válido.' })
      const ruta = (req.url ?? '').split('?')[0]
      if (req.method === 'GET' && ruta === '/v1/estado') return this.responder(res, 200, { ok: true, app: 'orbe' })
      if (req.method !== 'POST' || (ruta !== '/v1/eventos' && ruta !== '/v1/claude-code')) return this.responder(res, 404, { error: 'No existe.' })
      if (!this.dentroDeRafaga()) return this.responder(res, 429, { error: 'Demasiados avisos seguidos.' })

      const datos = await leerJson(req)
      if (datos === undefined) return this.responder(res, 400, { error: 'El cuerpo debe ser JSON (máximo 64 KB).' })
      const evento: EventoActividad | null = ruta === '/v1/claude-code' ? deClaudeCode(datos) : normalizarEvento(datos)
      if (evento) this.bus.publicar(evento)
      return this.responder(res, evento ? 202 : 204)
    } catch {
      if (!res.headersSent) this.responder(res, 500, { error: 'Error interno.' })
    }
  }
}

function leerJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolver) => {
    const trozos: Buffer[] = []
    let total = 0
    req.on('data', (t: Buffer) => {
      total += t.length
      if (total > CUERPO_MAX) {
        resolver(undefined)
        req.destroy()
      } else trozos.push(t)
    })
    req.on('end', () => {
      try {
        resolver(JSON.parse(Buffer.concat(trozos).toString('utf8') || 'null'))
      } catch {
        resolver(undefined)
      }
    })
    req.on('error', () => resolver(undefined))
  })
}
