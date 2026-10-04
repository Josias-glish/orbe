import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import type { EstadoFondo } from '../shared/tipos'

/** Lo que Electron sabe abrir (PNG y JPEG). */
export const EXTENSIONES_IMAGEN: ReadonlySet<string> = new Set(['.png', '.jpg', '.jpeg'])
export const VISIBILIDAD_POR_DEFECTO = 0.5
export const VISIBILIDAD_MIN = 0.1
export const VISIBILIDAD_MAX = 0.9
const REINTENTOS = 5

/** Abre una imagen y la devuelve ya reducida y en JPEG, o null si no se puede abrir. */
export type ProcesarImagen = (ruta: string) => Promise<Uint8Array | null>

interface Guardado {
  activo: boolean
  archivo: string | null
  visibilidad: number
}

export interface OpcionesFondos {
  /** Carpeta con las imágenes; null si no hay ninguna configurada. */
  carpeta: string | null
  /** Donde se recuerda qué fondo se eligió y cuánto se ve. */
  archivoEstado: string
  /** Donde se guardan las imágenes ya reducidas (las originales pueden ser de 4K y pesar decenas de MB). */
  carpetaCache: string
  procesar: ProcesarImagen
  /** Número entre 0 y 1; las pruebas lo fijan. */
  azar?: () => number
}

export const limitarVisibilidad = (v: number): number =>
  Number.isFinite(v) ? Math.round(Math.min(VISIBILIDAD_MAX, Math.max(VISIBILIDAD_MIN, v)) * 100) / 100 : VISIBILIDAD_POR_DEFECTO

/**
 * Fondos del chat: imágenes de una carpeta del usuario. Elige una al azar la primera vez, recuerda cuál y
 * cuánto se ve, y guarda una copia reducida para no abrir cada vez una imagen de 4K. No toca los originales.
 */
export class ServicioFondos {
  constructor(private readonly o: OpcionesFondos) {}

  /** Nombres de las imágenes de la carpeta, en orden alfabético. */
  listar(): string[] {
    if (!this.o.carpeta) return []
    try {
      return readdirSync(this.o.carpeta)
        .filter((n) => EXTENSIONES_IMAGEN.has(extname(n).toLowerCase()))
        .sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  }

  private leer(): Guardado {
    try {
      const g = JSON.parse(readFileSync(this.o.archivoEstado, 'utf8')) as Partial<Guardado>
      return {
        activo: g.activo !== false,
        archivo: typeof g.archivo === 'string' ? g.archivo : null,
        visibilidad: limitarVisibilidad(typeof g.visibilidad === 'number' ? g.visibilidad : VISIBILIDAD_POR_DEFECTO)
      }
    } catch {
      return { activo: true, archivo: null, visibilidad: VISIBILIDAD_POR_DEFECTO }
    }
  }

  private guardar(g: Guardado): void {
    try {
      mkdirSync(dirname(this.o.archivoEstado), { recursive: true })
      const temporal = `${this.o.archivoEstado}.tmp`
      writeFileSync(temporal, JSON.stringify(g, null, 2), 'utf8')
      renameSync(temporal, this.o.archivoEstado)
    } catch (error) {
      console.error('[orbe] No se pudo guardar el fondo elegido:', error)
    }
  }

  private elegirAlAzar(entre: string[], excepto: string | null): string {
    const candidatos = entre.length > 1 ? entre.filter((n) => n !== excepto) : entre
    return candidatos[Math.min(candidatos.length - 1, Math.floor((this.o.azar?.() ?? Math.random()) * candidatos.length))]
  }

  /** La imagen reducida como data URL, de la caché si ya se hizo. Null si no se puede abrir. */
  private async cargar(nombre: string): Promise<string | null> {
    if (!this.o.carpeta) return null
    const ruta = join(this.o.carpeta, nombre)
    let huella: string
    try {
      const s = statSync(ruta)
      huella = createHash('sha1').update(`${nombre}|${s.size}|${s.mtimeMs}|v1`).digest('hex').slice(0, 20)
    } catch {
      return null
    }
    const enCache = join(this.o.carpetaCache, `${huella}.jpg`)
    let jpeg: Uint8Array | null = null
    try {
      jpeg = readFileSync(enCache)
    } catch {
      // aún no está en la caché
    }
    if (!jpeg) {
      try {
        jpeg = await this.o.procesar(ruta)
      } catch {
        jpeg = null
      }
      if (!jpeg || jpeg.length === 0) return null
      try {
        mkdirSync(this.o.carpetaCache, { recursive: true })
        writeFileSync(`${enCache}.tmp`, jpeg)
        renameSync(`${enCache}.tmp`, enCache)
      } catch {
        // sin caché funciona igual, solo más lento la próxima vez
      }
    }
    return `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`
  }

  /**
   * Prueba con el fondo guardado y, si no se puede abrir (borrado, estropeado), con otros al azar hasta
   * encontrar uno que sirva. Devuelve el nombre y la imagen; null si ninguno vale.
   */
  private async resolver(g: Guardado, nombres: string[], cargarImagen: boolean): Promise<{ nombre: string; imagen: string | null } | null> {
    const probados = new Set<string>()
    let nombre = g.archivo && nombres.includes(g.archivo) ? g.archivo : this.elegirAlAzar(nombres, null)
    for (let i = 0; i < REINTENTOS; i++) {
      probados.add(nombre)
      if (!cargarImagen) return { nombre, imagen: null }
      const imagen = await this.cargar(nombre)
      if (imagen) return { nombre, imagen }
      const quedan = nombres.filter((n) => !probados.has(n))
      if (quedan.length === 0) return null
      nombre = this.elegirAlAzar(quedan, null)
    }
    return null
  }

  private vacio(g: Guardado): EstadoFondo {
    return { disponible: false, activo: false, visibilidad: g.visibilidad, nombre: null, total: 0, imagen: null }
  }

  /** El estado del fondo con su imagen (si está activo). La primera vez elige uno al azar. */
  async estado(): Promise<EstadoFondo> {
    const g = this.leer()
    const nombres = this.listar()
    if (nombres.length === 0) return this.vacio(g)
    const r = await this.resolver(g, nombres, g.activo)
    if (!r) return { ...this.vacio(g), disponible: true, activo: g.activo, total: nombres.length }
    if (r.nombre !== g.archivo) this.guardar({ ...g, archivo: r.nombre })
    return { disponible: true, activo: g.activo, visibilidad: g.visibilidad, nombre: r.nombre, total: nombres.length, imagen: r.imagen }
  }

  /** Cambia a otra imagen al azar (distinta de la actual si hay más de una) y la activa. */
  async siguiente(): Promise<EstadoFondo> {
    const g = this.leer()
    const nombres = this.listar()
    if (nombres.length === 0) return this.vacio(g)
    const otro: Guardado = { ...g, activo: true, archivo: this.elegirAlAzar(nombres, g.archivo) }
    this.guardar(otro)
    return this.estado()
  }

  /**
   * Cambia si se ve el fondo o cuánto. Devuelve el estado sin la imagen salvo que se haya activado, para que
   * mover el control de visibilidad no mande cientos de KB cada vez.
   */
  async ajustar(cambios: { activo?: boolean; visibilidad?: number }): Promise<EstadoFondo> {
    const g = this.leer()
    const nuevo: Guardado = {
      ...g,
      activo: cambios.activo ?? g.activo,
      visibilidad: cambios.visibilidad !== undefined ? limitarVisibilidad(cambios.visibilidad) : g.visibilidad
    }
    this.guardar(nuevo)
    if (cambios.activo === true) return this.estado()
    const total = this.listar().length
    return {
      disponible: total > 0,
      activo: nuevo.activo,
      visibilidad: nuevo.visibilidad,
      nombre: nuevo.archivo,
      total,
      imagen: null
    }
  }
}
