import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ResumenUso, TotalUso, UsoTokens } from '../../shared/tipos'

export type Proveedor = 'cli' | 'api' | 'openai'

/** Precio en dólares por millón de tokens. `cacheLectura`/`cacheEscritura` se calculan si faltan (0,1× y 1,25× la entrada). */
interface Tarifa {
  entrada: number
  salida: number
  cacheLectura?: number
  cacheEscritura?: number
}

/**
 * Tarifas públicas de la API de Anthropic (dólares por millón de tokens). Se busca por prefijo del id del modelo, así
 * que «claude-sonnet-4-5-20250929» encuentra «claude-sonnet-4-5». Los servicios gratuitos o desconocidos no están:
 * su coste queda «sin precio» y la interfaz lo dice.
 */
export const TARIFAS: ReadonlyArray<[prefijo: string, tarifa: Tarifa]> = [
  ['claude-fable-5-1', { entrada: 10, salida: 50, cacheLectura: 0.25 }],
  ['claude-mythos-5-1', { entrada: 10, salida: 50, cacheLectura: 0.25 }],
  ['claude-fable-5', { entrada: 10, salida: 50 }],
  ['claude-opus-5-5', { entrada: 4, salida: 20, cacheLectura: 0.2 }],
  ['claude-opus-5', { entrada: 5, salida: 25 }],
  ['claude-opus-4', { entrada: 5, salida: 25 }],
  ['claude-sonnet-5-5', { entrada: 2, salida: 10, cacheLectura: 0.2 }],
  ['claude-sonnet-5', { entrada: 2, salida: 10, cacheLectura: 0.2 }],
  ['claude-sonnet-4', { entrada: 3, salida: 15 }],
  ['claude-haiku-5-5', { entrada: 0.1, salida: 0.5, cacheLectura: 0.01 }],
  ['claude-haiku-4', { entrada: 1, salida: 5 }]
]

export function tarifaDe(modelo: string): Tarifa | null {
  const m = modelo.toLowerCase().trim()
  for (const [prefijo, tarifa] of TARIFAS) if (m === prefijo || m.startsWith(`${prefijo}-`)) return tarifa
  return null
}

/** Coste estimado de un uso; null si el modelo no tiene tarifa conocida. */
export function estimarCoste(modelo: string, uso: UsoTokens): number | null {
  const t = tarifaDe(modelo)
  if (!t) return null
  const lectura = t.cacheLectura ?? t.entrada * 0.1
  const escritura = t.cacheEscritura ?? t.entrada * 1.25
  return (
    (uso.entrada * t.entrada + uso.salida * t.salida + (uso.cacheLectura ?? 0) * lectura + (uso.cacheEscritura ?? 0) * escritura) / 1_000_000
  )
}

interface Fila {
  entrada: number
  salida: number
  cache: number
  peticiones: number
  costeUsd: number
  /** Peticiones de esta fila sin precio conocido. */
  sinPrecio: number
}

interface Datos {
  version: 1
  desde: number | null
  /** fecha local «AAAA-MM-DD» → «proveedor|modelo» → totales. */
  dias: Record<string, Record<string, Fila>>
  limiteCli: ResumenUso['limiteCli']
}

const DIAS_GUARDADOS = 400

function fechaLocal(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function cero(): TotalUso {
  return { entrada: 0, salida: 0, cache: 0, peticiones: 0, costeUsd: 0, sinPrecio: false }
}

function sumar(t: TotalUso, f: Fila): void {
  t.entrada += f.entrada
  t.salida += f.salida
  t.cache += f.cache
  t.peticiones += f.peticiones
  t.costeUsd += f.costeUsd
  if (f.sinPrecio > 0) t.sinPrecio = true
}

function numero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

/**
 * Lleva la cuenta de lo que gasta Orbe en cada servicio: tokens de entrada y salida, caché, peticiones y dólares
 * (los que da el servicio o, si no, estimados con la tabla de tarifas). Se guarda por día en un JSON pequeño de la
 * carpeta de datos; nunca guarda el contenido de las conversaciones.
 */
export class RegistroUso {
  private datos: Datos
  private pendiente: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly archivo: string | null,
    private readonly ahora: () => number = Date.now
  ) {
    this.datos = this.cargar()
  }

  private cargar(): Datos {
    const vacio: Datos = { version: 1, desde: null, dias: {}, limiteCli: null }
    if (!this.archivo || !existsSync(this.archivo)) return vacio
    try {
      const leido = JSON.parse(readFileSync(this.archivo, 'utf8')) as Partial<Datos>
      if (leido.version !== 1 || typeof leido.dias !== 'object' || leido.dias === null) return vacio
      const dias: Datos['dias'] = {}
      for (const [fecha, filas] of Object.entries(leido.dias)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || typeof filas !== 'object' || filas === null) continue
        dias[fecha] = {}
        for (const [clave, f] of Object.entries(filas as Record<string, Partial<Fila>>)) {
          dias[fecha][clave] = {
            entrada: numero(f.entrada),
            salida: numero(f.salida),
            cache: numero(f.cache),
            peticiones: numero(f.peticiones),
            costeUsd: numero(f.costeUsd),
            sinPrecio: numero(f.sinPrecio)
          }
        }
      }
      return { version: 1, desde: typeof leido.desde === 'number' ? leido.desde : null, dias, limiteCli: leido.limiteCli ?? null }
    } catch {
      return vacio
    }
  }

  /** Apunta lo que gastó una llamada. */
  anotar(proveedor: Proveedor, modelo: string, uso: UsoTokens): void {
    const t = this.ahora()
    const fecha = fechaLocal(t)
    const clave = `${proveedor}|${modelo || 'desconocido'}`
    const dia = (this.datos.dias[fecha] ??= {})
    const fila = (dia[clave] ??= { entrada: 0, salida: 0, cache: 0, peticiones: 0, costeUsd: 0, sinPrecio: 0 })
    fila.entrada += numero(uso.entrada)
    fila.salida += numero(uso.salida)
    fila.cache += numero(uso.cacheLectura) + numero(uso.cacheEscritura)
    fila.peticiones += 1
    const coste = uso.costeUsd !== undefined ? numero(uso.costeUsd) : estimarCoste(modelo, uso)
    if (coste === null) fila.sinPrecio += 1
    else fila.costeUsd += coste
    this.datos.desde ??= t
    this.guardarPronto()
  }

  anotarLimite(limite: { estado: string; tipo: string | null; reinicio: number | null }): void {
    this.datos.limiteCli = { ...limite, cuando: this.ahora() }
    this.guardarPronto()
  }

  borrar(): void {
    this.datos = { version: 1, desde: null, dias: {}, limiteCli: null }
    this.guardarAhora()
  }

  resumen(): ResumenUso {
    const t = this.ahora()
    const hoy = fechaLocal(t)
    const hace = (dias: number): string => fechaLocal(t - dias * 86_400_000)
    const inicioSemana = hace(6)
    const inicioMes = `${hoy.slice(0, 7)}-01`
    const r: ResumenUso = {
      hoy: cero(),
      semana: cero(),
      mes: cero(),
      total: cero(),
      dias: [],
      porModelo: [],
      limiteCli: this.datos.limiteCli,
      desde: this.datos.desde
    }
    const porModelo = new Map<string, TotalUso>()
    for (const [fecha, filas] of Object.entries(this.datos.dias)) {
      for (const [clave, f] of Object.entries(filas)) {
        sumar(r.total, f)
        if (fecha >= inicioMes) {
          sumar(r.mes, f)
          let m = porModelo.get(clave)
          if (!m) porModelo.set(clave, (m = cero()))
          sumar(m, f)
        }
        if (fecha >= inicioSemana) sumar(r.semana, f)
        if (fecha === hoy) sumar(r.hoy, f)
      }
    }
    for (let i = 13; i >= 0; i--) {
      const fecha = hace(i)
      let tokens = 0
      let coste = 0
      for (const f of Object.values(this.datos.dias[fecha] ?? {})) {
        tokens += f.entrada + f.salida
        coste += f.costeUsd
      }
      r.dias.push({ fecha, tokens, costeUsd: coste })
    }
    r.porModelo = [...porModelo.entries()]
      .map(([clave, total]) => {
        const corte = clave.indexOf('|')
        return { proveedor: clave.slice(0, corte) as Proveedor, modelo: clave.slice(corte + 1), ...total }
      })
      .sort((a, b) => b.costeUsd - a.costeUsd || b.entrada + b.salida - (a.entrada + a.salida))
    return r
  }

  private guardarPronto(): void {
    if (!this.archivo || this.pendiente) return
    this.pendiente = setTimeout(() => this.guardarAhora(), 1000)
    this.pendiente.unref?.()
  }

  guardarAhora(): void {
    if (this.pendiente) clearTimeout(this.pendiente)
    this.pendiente = null
    if (!this.archivo) return
    // Solo se guardan los últimos DIAS_GUARDADOS días (el total histórico se pierde de ahí para atrás).
    const fechas = Object.keys(this.datos.dias).sort()
    for (const f of fechas.slice(0, Math.max(0, fechas.length - DIAS_GUARDADOS))) delete this.datos.dias[f]
    try {
      mkdirSync(dirname(this.archivo), { recursive: true })
      const temporal = `${this.archivo}.tmp`
      writeFileSync(temporal, JSON.stringify(this.datos), 'utf8')
      renameSync(temporal, this.archivo)
    } catch {
      // sin disco: se pierde solo el último apunte
    }
  }
}
