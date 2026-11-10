import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CUENTAS, NOMBRE_CUENTA, type Cuenta } from '../conectores/instagram/cliente'
import type { CambiosPieza, Pieza } from '../../shared/tipos'

/** Medidas que acepta Instagram para una imagen (vertical 4:5, cuadrada y vertical 9:16) y el peso máximo. */
export const MEDIDAS = [[1080, 1350], [1080, 1080], [1080, 1920]] as const
export const PESO_MAX = 8 * 1024 * 1024
/** Un archivo que aún se está escribiendo no se toca: tiene que llevar este tiempo quieto. */
const QUIETO_MS = 2000

const FICHA = (marca: Cuenta): string => `# ${NOMBRE_CUENTA[marca]}

Rellena esta ficha una vez: Orbe la lee antes de proponer textos para esta marca.

## A quién le habla
-

## Tono de voz
-

## Temas que sí
-

## Temas que no
-

## Hashtags habituales
-
`

/** Ancho y alto de un PNG leyendo su cabecera (IHDR); `null` si no es un PNG. */
export function medidasPng(datos: Buffer): { ancho: number; alto: number } | null {
  const firma = '89504e470d0a1a0a'
  if (datos.length < 24 || datos.subarray(0, 8).toString('hex') !== firma || datos.subarray(12, 16).toString('latin1') !== 'IHDR') return null
  return { ancho: datos.readUInt32BE(16), alto: datos.readUInt32BE(20) }
}

/** Por qué no vale un PNG para Instagram, o `null` si vale. */
export function problemaPng(datos: Buffer): string | null {
  if (datos.length > PESO_MAX) return `pesa ${(datos.length / 1048576).toFixed(1)} MB (máximo 8 MB)`
  const m = medidasPng(datos)
  if (!m) return 'no es un PNG válido'
  if (!MEDIDAS.some(([a, h]) => a === m.ancho && h === m.alto)) return `mide ${m.ancho}×${m.alto}; se espera 1080×1350, 1080×1080 o 1080×1920`
  return null
}

/** «p1a2b-3.png» → { base: 'p1a2b', orden: 3 }. Varios archivos con la misma base forman un carrusel. */
function partes(nombre: string): { base: string; orden: number } {
  const sin = nombre.replace(/\.(png|html?)$/i, '')
  const m = /^(.*?)[-_ ](\d{1,2})$/.exec(sin)
  return m ? { base: m[1], orden: Number(m[2]) } : { base: sin, orden: 0 }
}

export interface DepsAlmacen {
  /** Convierte un HTML de diseño en PNG (ventana oculta sin red ni JavaScript). Sin él, los HTML se ignoran. */
  renderizar?: (html: string, carpetaMarca: string) => Promise<Buffer>
  ahora?: () => number
}

/**
 * Las piezas de contenido (idea, texto de la imagen, pie, hashtags e imágenes) de cada marca, en
 * `contenido/contenido.json`. Nada sale del equipo: aprobar solo marca la pieza como lista para la Etapa 4.
 *
 * Carpetas bajo `contenido/`: `marcas/<marca>/marca.md` (la ficha), `entrada/<marca>/` (donde se exportan los PNG de
 * Claude Design), `piezas/<id>/` (las imágenes ya recogidas) y `papelera/` (lo que se borra desde la pestaña).
 */
export class AlmacenContenido {
  private piezas: Pieza[] = []
  /** Archivos de entrada que no valen y por qué (se recalcula en cada recogida; el archivo se queda donde está). */
  avisos: string[] = []

  constructor(
    readonly raiz: string,
    private readonly deps: DepsAlmacen = {}
  ) {
    for (const marca of CUENTAS) {
      mkdirSync(this.entrada(marca), { recursive: true })
      const ficha = join(raiz, 'marcas', marca, 'marca.md')
      if (!existsSync(ficha)) {
        mkdirSync(join(raiz, 'marcas', marca), { recursive: true })
        writeFileSync(ficha, FICHA(marca))
      }
    }
    try {
      const leidas: unknown = JSON.parse(readFileSync(this.archivo, 'utf8'))
      if (Array.isArray(leidas)) this.piezas = leidas as Pieza[]
    } catch {
      // Sin archivo (o ilegible) se empieza vacío; el ilegible no se pisa hasta el primer cambio.
    }
  }

  private get archivo(): string {
    return join(this.raiz, 'contenido.json')
  }

  entrada(marca: Cuenta): string {
    return join(this.raiz, 'entrada', marca)
  }

  ficha(marca: Cuenta): string {
    return readFileSync(join(this.raiz, 'marcas', marca, 'marca.md'), 'utf8')
  }

  rutaArchivo(pieza: Pieza, nombre: string): string {
    return join(this.raiz, 'piezas', pieza.id, nombre)
  }

  lista(): readonly Pieza[] {
    return this.piezas
  }

  private ahora(): number {
    return this.deps.ahora?.() ?? Date.now()
  }

  private guardar(): void {
    writeFileSync(this.archivo, JSON.stringify(this.piezas, null, 2))
  }

  private buscar(id: string): Pieza {
    const p = this.piezas.find((x) => x.id === id)
    if (!p) throw new Error('Esa pieza ya no existe.')
    return p
  }

  proponer(datos: { marca: Cuenta; idea: string; texto: string; pie: string; hashtags: string[] }): Pieza {
    const ahora = this.ahora()
    let id = 'p' + ahora.toString(36)
    while (this.piezas.some((p) => p.id === id)) id += 'x'
    const pieza: Pieza = { id, ...datos, archivos: [], aprobada: false, creada: ahora, actualizada: ahora }
    this.piezas.unshift(pieza)
    this.guardar()
    return pieza
  }

  /** Cambiar el texto de una pieza aprobada le quita la aprobación: lo aprobado es exactamente lo que se vio. */
  actualizar(id: string, cambios: CambiosPieza): Pieza {
    const p = this.buscar(id)
    Object.assign(p, cambios, { aprobada: false, actualizada: this.ahora() })
    this.guardar()
    return p
  }

  aprobar(id: string, aprobada: boolean): Pieza {
    const p = this.buscar(id)
    if (aprobada && p.archivos.length === 0) throw new Error('Falta la imagen: exporta el PNG antes de aprobar.')
    p.aprobada = aprobada
    p.actualizada = this.ahora()
    this.guardar()
    return p
  }

  /** Quita la pieza de la lista y mueve sus imágenes a `papelera/` (no se borra nada del disco). */
  borrar(id: string): void {
    this.buscar(id)
    const carpeta = join(this.raiz, 'piezas', id)
    if (existsSync(carpeta)) {
      mkdirSync(join(this.raiz, 'papelera'), { recursive: true })
      renameSync(carpeta, join(this.raiz, 'papelera', `${id}-${this.ahora()}`))
    }
    this.piezas = this.piezas.filter((p) => p.id !== id)
    this.guardar()
  }

  /**
   * Recoge lo exportado en `entrada/<marca>/`: cada PNG válido (o HTML, que se convierte en PNG) va a la pieza cuyo id
   * empieza su nombre (`p1a2b.png`, `p1a2b-2.png`…) o, si no hay ninguna, a una pieza nueva sin texto. Devuelve si
   * cambió algo.
   */
  async recoger(): Promise<boolean> {
    const avisos: string[] = []
    let cambio = false
    for (const marca of CUENTAS) {
      const carpeta = this.entrada(marca)
      let nombres: string[]
      try {
        nombres = readdirSync(carpeta).filter((n) => /\.(png|html?)$/i.test(n))
      } catch {
        continue
      }
      nombres.sort((a, b) => partes(a).orden - partes(b).orden || a.localeCompare(b))
      for (const nombre of nombres) {
        const ruta = join(carpeta, nombre)
        const info = statSync(ruta)
        if (this.ahora() - info.mtimeMs < QUIETO_MS) continue
        let datos: Buffer
        try {
          if (/\.png$/i.test(nombre)) datos = readFileSync(ruta)
          else if (this.deps.renderizar) datos = await this.deps.renderizar(readFileSync(ruta, 'utf8'), join(this.raiz, 'marcas', marca))
          else continue
        } catch (e) {
          avisos.push(`${marca}/${nombre}: no he podido leerlo (${e instanceof Error ? e.message : String(e)}).`)
          continue
        }
        const problema = problemaPng(datos)
        if (problema) {
          avisos.push(`${marca}/${nombre}: ${problema}.`)
          continue
        }
        const { base } = partes(nombre)
        const pieza =
          this.piezas.find((p) => p.id === base && p.marca === marca) ??
          this.proponer({ marca, idea: `Diseño importado: ${base}`, texto: '', pie: '', hashtags: [] })
        const destino = join(this.raiz, 'piezas', pieza.id)
        mkdirSync(destino, { recursive: true })
        const final = `${pieza.id}-${pieza.archivos.length + 1}.png`
        writeFileSync(join(destino, final), datos)
        renameSync(ruta, join(destino, `original-${this.ahora()}-${nombre}`))
        pieza.archivos.push(final)
        pieza.aprobada = false
        pieza.actualizada = this.ahora()
        cambio = true
      }
    }
    this.avisos = avisos
    if (cambio) this.guardar()
    return cambio
  }

  /** El encargo que se pega en Claude Design para diseñar una pieza. */
  encargo(id: string): string {
    const p = this.buscar(id)
    return [
      `Diseña un post de Instagram de 1080×1350 para ${NOMBRE_CUENTA[p.marca]} con el sistema de diseño de este proyecto.`,
      `Idea: ${p.idea}`,
      p.texto ? `Texto de la imagen: ${p.texto}` : '',
      'Si es un carrusel, una mesa de trabajo por diapositiva, todas de 1080×1350.',
      `Exporta en PNG y guarda el archivo como ${p.id}.png (carrusel: ${p.id}-1.png, ${p.id}-2.png…) en la carpeta:`,
      this.entrada(p.marca)
    ]
      .filter(Boolean)
      .join('\n')
  }
}

/** Solo los campos de texto conocidos, recortados: lo que llega de la interfaz no se guarda tal cual. */
export function limpiarCambios(c: unknown): CambiosPieza {
  const o = (c ?? {}) as Record<string, unknown>
  const salida: CambiosPieza = {}
  for (const k of ['idea', 'texto', 'pie'] as const) if (typeof o[k] === 'string') salida[k] = o[k].slice(0, 2200)
  if (Array.isArray(o.hashtags)) salida.hashtags = o.hashtags.filter((h): h is string => typeof h === 'string').slice(0, 30)
  return salida
}
