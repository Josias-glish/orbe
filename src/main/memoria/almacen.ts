import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TipoMemoria } from '../../shared/tipos'
import { ID_VALIDO, aSlug, parsearNota, serializarNota, tipoDeOrbe, tipoParaArchivo } from './formato'

export interface Recuerdo {
  id: string
  tipo: TipoMemoria
  /** Resumen de una línea. */
  descripcion: string
  cuerpo: string
  origen: 'claude' | 'usuario'
  usar: boolean
  completo: boolean
  /** ISO 8601. */
  modificado: string
}

export interface RegistroImportado {
  /** Archivo (sin .md) en el que quedó. */
  id: string
  /** Huella de la nota de Claude tal como estaba al importarla. */
  hashOrigen: string
  /** Huella de resumen+texto tal como se escribieron aquí: si cambia, es que el usuario la editó. */
  hashContenido: string
}

export interface ConfigMemoria {
  version: 1
  activa: boolean
  /** La importación inicial desde Claude ya se intentó. */
  importacionInicialHecha: boolean
  /** Aviso pendiente de enseñar (una sola vez), tras la importación inicial. */
  bienvenida: string | null
  /** Notas de Claude ya traídas, por su nombre en Claude. */
  importados: Record<string, RegistroImportado>
  /** Nombres de Claude que el usuario borró aquí: no se vuelven a importar. */
  ignorados: string[]
}

const CONFIG_POR_DEFECTO = (): ConfigMemoria => ({
  version: 1,
  activa: true,
  importacionInicialHecha: false,
  bienvenida: null,
  importados: {},
  ignorados: []
})

export const MAX_RECUERDOS = 200
export const MAX_DESCRIPCION = 300
export const MAX_CUERPO = 8000

/** Huella corta y estable de un texto. */
export function huella(texto: string): string {
  return createHash('sha1').update(texto).digest('hex').slice(0, 16)
}

/** Huella de lo que el usuario puede editar de un recuerdo (no cuenta activar/desactivar ni «completo»). */
export function huellaContenido(r: Pick<Recuerdo, 'descripcion' | 'cuerpo'>): string {
  return huella(`${r.descripcion}\u0000${r.cuerpo}`)
}

/**
 * La carpeta de la memoria: un .md por recuerdo, en el mismo formato que la memoria de Claude Code,
 * para que se pueda leer y editar con cualquier editor. La configuración va en `_config.json`.
 */
export class AlmacenMemoria {
  constructor(readonly carpeta: string) {}

  private rutaDe(id: string): string {
    if (!ID_VALIDO.test(id)) throw new Error(`Identificador de recuerdo no válido: ${id}`)
    return join(this.carpeta, `${id}.md`)
  }

  listar(): Recuerdo[] {
    let archivos: string[]
    try {
      archivos = readdirSync(this.carpeta)
    } catch {
      return []
    }
    const recuerdos: Recuerdo[] = []
    for (const archivo of archivos) {
      if (!archivo.toLowerCase().endsWith('.md') || archivo.startsWith('_')) continue
      const id = archivo.slice(0, -3)
      if (!ID_VALIDO.test(id)) continue
      const r = this.leer(id)
      if (r) recuerdos.push(r)
    }
    return recuerdos.sort((a, b) => b.modificado.localeCompare(a.modificado) || a.id.localeCompare(b.id))
  }

  obtener(id: string): Recuerdo | null {
    return ID_VALIDO.test(id) ? this.leer(id) : null
  }

  private leer(id: string): Recuerdo | null {
    const ruta = join(this.carpeta, `${id}.md`)
    try {
      const nota = parsearNota(readFileSync(ruta, 'utf8'), `${id}.md`)
      return {
        id,
        tipo: tipoDeOrbe(nota.tipo),
        descripcion: nota.descripcion,
        cuerpo: nota.cuerpo,
        origen: nota.meta['origen'] === 'claude' ? 'claude' : 'usuario',
        usar: nota.meta['usar'] !== 'false',
        completo: nota.meta['completo'] === 'true',
        modificado: nota.meta['modified'] ?? statSync(ruta).mtime.toISOString()
      }
    } catch {
      return null
    }
  }

  /** Escribe un recuerdo (crea o sustituye) de forma atómica: nunca queda un archivo a medias. */
  guardar(r: Recuerdo): void {
    const ruta = this.rutaDe(r.id)
    mkdirSync(this.carpeta, { recursive: true })
    const texto = serializarNota({
      nombre: r.id,
      descripcion: r.descripcion,
      tipo: tipoParaArchivo(r.tipo),
      cuerpo: r.cuerpo,
      meta: { origen: r.origen, usar: String(r.usar), completo: String(r.completo), modified: r.modificado }
    })
    const temporal = `${ruta}.tmp`
    writeFileSync(temporal, texto, 'utf8')
    renameSync(temporal, ruta)
  }

  borrar(id: string): boolean {
    const ruta = this.rutaDe(id)
    if (!existsSync(ruta)) return false
    rmSync(ruta, { force: true })
    return true
  }

  /** Borra todos los recuerdos y reinicia la configuración de importación (conserva si la memoria está activa). */
  vaciar(): void {
    for (const r of this.listar()) this.borrar(r.id)
    const c = this.config()
    this.guardarConfig({ ...CONFIG_POR_DEFECTO(), activa: c.activa, importacionInicialHecha: true })
  }

  /** Un identificador libre a partir de un texto («nota-tortilla», «nota-tortilla-2»…). */
  idLibre(base: string): string {
    const raiz = aSlug(base)
    let id = raiz
    for (let n = 2; existsSync(join(this.carpeta, `${id}.md`)); n++) id = `${raiz.slice(0, 74)}-${n}`
    return id
  }

  config(): ConfigMemoria {
    try {
      const leida = JSON.parse(readFileSync(join(this.carpeta, '_config.json'), 'utf8')) as Partial<ConfigMemoria>
      const base = CONFIG_POR_DEFECTO()
      return {
        ...base,
        activa: typeof leida.activa === 'boolean' ? leida.activa : base.activa,
        importacionInicialHecha: leida.importacionInicialHecha === true,
        bienvenida: typeof leida.bienvenida === 'string' ? leida.bienvenida : null,
        importados: leida.importados && typeof leida.importados === 'object' ? leida.importados : {},
        ignorados: Array.isArray(leida.ignorados) ? leida.ignorados.filter((x) => typeof x === 'string') : []
      }
    } catch {
      return CONFIG_POR_DEFECTO()
    }
  }

  guardarConfig(config: ConfigMemoria): void {
    mkdirSync(this.carpeta, { recursive: true })
    const ruta = join(this.carpeta, '_config.json')
    const temporal = `${ruta}.tmp`
    writeFileSync(temporal, JSON.stringify(config, null, 2), 'utf8')
    renameSync(temporal, ruta)
  }

  /** ¿Existe ya la carpeta de memoria? (la primera vez no, y entonces se hace la importación inicial). */
  existe(): boolean {
    return existsSync(join(this.carpeta, '_config.json'))
  }
}
