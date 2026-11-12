import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type TipoDoc = 'conversacion' | 'recuerdo' | 'metricas' | 'contenido'

export interface DocIndice {
  tipo: TipoDoc
  /** Identificador dentro de su tipo (id de la conversación, del recuerdo, la cuenta…). */
  ref: string
  titulo: string
  texto: string
  /** ISO 8601. */
  fecha: string
}

export interface ResultadoBusqueda {
  tipo: TipoDoc
  ref: string
  titulo: string
  fecha: string
  /** El trozo donde aparece lo buscado, con lo encontrado entre «». */
  fragmento: string
}

/**
 * Lo que escribe el usuario, pasado a FTS5 sin su sintaxis: cada palabra entre comillas y como prefijo, todas
 * obligatorias. Así «cámara foto» encuentra «Cámaras de fotos» y ningún texto puede romper la consulta.
 */
export function consultaFts(texto: string, cualquiera = false): string | null {
  // Con «cualquiera» basta una palabra; las de una o dos letras sobran (artículos, preposiciones).
  const palabras = (texto.normalize('NFC').match(cualquiera ? /[\p{L}\p{N}]{4,}/gu : /[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, cualquiera ? 30 : 12)
  return palabras.length > 0 ? palabras.map((p) => `"${p}"*`).join(cualquiera ? ' OR ' : ' ') : null
}

/**
 * La base de datos local de Orbe (SQLite de Node, sin dependencias): un índice de búsqueda de texto completo sobre
 * conversaciones, recuerdos, métricas y contenido. Los archivos siguen siendo la fuente; el índice se rehace a partir
 * de ellos, así que nunca hay dos copias que se contradigan.
 */
export class BaseOrbe {
  private readonly db: DatabaseSync

  constructor(ruta: string) {
    if (ruta !== ':memory:') mkdirSync(dirname(ruta), { recursive: true })
    this.db = new DatabaseSync(ruta)
    this.db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS indice USING fts5(tipo UNINDEXED, ref UNINDEXED, titulo, texto, fecha UNINDEXED, tokenize='unicode61 remove_diacritics 2');" +
        'CREATE TABLE IF NOT EXISTS uso (ref TEXT PRIMARY KEY, ultimo TEXT NOT NULL);' +
        'CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);'
    )
  }

  /** Anota que se usaron esos recuerdos (para la caducidad). */
  marcarUso(refs: readonly string[], cuando = new Date()): void {
    const poner = this.db.prepare('INSERT INTO uso (ref, ultimo) VALUES (?, ?) ON CONFLICT(ref) DO UPDATE SET ultimo = excluded.ultimo')
    for (const r of refs) poner.run(r, cuando.toISOString())
  }

  ultimoUso(ref: string): string | null {
    const f = this.db.prepare('SELECT ultimo FROM uso WHERE ref = ?').get(ref) as { ultimo: string } | undefined
    return f?.ultimo ?? null
  }

  leerMeta(clave: string): string | null {
    const f = this.db.prepare('SELECT valor FROM meta WHERE clave = ?').get(clave) as { valor: string } | undefined
    return f?.valor ?? null
  }

  fijarMeta(clave: string, valor: string): void {
    this.db.prepare('INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(clave, valor)
  }

  // ponytail: se rehace entero en cada búsqueda (cientos de documentos, milisegundos); si crece a miles, actualizar
  // solo lo que cambió.
  reindexar(docs: readonly DocIndice[]): void {
    const insertar = this.db.prepare('INSERT INTO indice (tipo, ref, titulo, texto, fecha) VALUES (?, ?, ?, ?, ?)')
    this.db.exec('BEGIN')
    try {
      this.db.exec('DELETE FROM indice')
      for (const d of docs) insertar.run(d.tipo, d.ref, d.titulo, d.texto, d.fecha)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  buscar(texto: string, opciones: { limite?: number; tipos?: readonly TipoDoc[]; cualquiera?: boolean } = {}): ResultadoBusqueda[] {
    const consulta = consultaFts(texto, opciones.cualquiera)
    if (!consulta) return []
    const tipos = opciones.tipos ?? ['conversacion', 'recuerdo', 'metricas', 'contenido']
    const filas = this.db
      .prepare(
        `SELECT tipo, ref, titulo, fecha, snippet(indice, 3, '«', '»', '…', 14) AS fragmento FROM indice
         WHERE indice MATCH ? AND tipo IN (${tipos.map(() => '?').join(',')}) ORDER BY rank LIMIT ?`
      )
      .all(consulta, ...tipos, Math.min(50, opciones.limite ?? 8)) as unknown as ResultadoBusqueda[]
    return filas.map((f) => ({ ...f }))
  }

  cerrar(): void {
    this.db.close()
  }
}

/** Lee un JSON sin fallar: null si no existe o no se entiende. */
export function leerJson(ruta: string): unknown {
  try {
    return JSON.parse(readFileSync(ruta, 'utf8'))
  } catch {
    return null
  }
}
