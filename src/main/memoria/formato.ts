import type { TipoMemoria } from '../../shared/tipos'

/**
 * Formato de las notas de memoria: el mismo que usa la memoria de Claude Code. Un archivo .md con una
 * cabecera YAML sencilla (name, description y un bloque metadata con type) y el texto debajo.
 */
export interface NotaMd {
  nombre: string
  descripcion: string
  /** Tipo tal como viene en el archivo: user, feedback, project, reference, note… */
  tipo: string
  cuerpo: string
  /** El resto de la cabecera (modified, origen, usar, completo…). */
  meta: Record<string, string>
}

const CABECERA = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/

function leerValor(crudo: string): string {
  const v = crudo.trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    try {
      const analizado: unknown = JSON.parse(v)
      if (typeof analizado === 'string') return analizado
    } catch {
      // no era JSON válido: se quitan solo las comillas
    }
    return v.slice(1, -1)
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'")
  return v
}

/** Lee una nota. Sin cabecera, todo el archivo es el texto y la primera línea hace de resumen. */
export function parsearNota(texto: string, nombreArchivo: string): NotaMd {
  const base = nombreArchivo.replace(/\.md$/i, '')
  const m = CABECERA.exec(texto)
  if (!m) {
    const cuerpo = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()
    return { nombre: base, descripcion: primeraLinea(cuerpo, 140), tipo: 'note', cuerpo, meta: {} }
  }

  const plano: Record<string, string> = {}
  const meta: Record<string, string> = {}
  let enMetadata = false
  for (const linea of m[1].split(/\r?\n/)) {
    if (!linea.trim() || linea.trim().startsWith('#')) continue
    const sangrada = /^[ \t]+/.test(linea)
    const kv = /^[ \t]*([A-Za-z_][\w-]*)[ \t]*:(.*)$/.exec(linea)
    if (!kv) continue
    const [, clave, valor] = kv
    if (!sangrada) {
      if (clave === 'metadata' && valor.trim() === '') {
        enMetadata = true
        continue
      }
      enMetadata = false
      plano[clave] = leerValor(valor)
    } else if (enMetadata) {
      meta[clave] = leerValor(valor)
    }
  }

  const { name, description, type, ...resto } = plano
  const tipo = meta['type'] ?? type ?? 'note'
  delete meta['type']
  const cuerpo = m[2].replace(/\r\n?/g, '\n').trim()
  return {
    nombre: name || base,
    descripcion: description || primeraLinea(cuerpo, 140),
    tipo,
    cuerpo,
    meta: { ...resto, ...meta }
  }
}

function primeraLinea(texto: string, max: number): string {
  const linea = texto.split('\n').find((l) => l.trim()) ?? ''
  return linea.length <= max ? linea.trim() : `${linea.slice(0, max).trimEnd()}…`
}

function escribirValorMeta(v: string): string {
  return /^[\w.:+/-]+$/.test(v) ? v : JSON.stringify(v)
}

/** Escribe una nota con la cabecera de siempre; `meta` va en el bloque metadata. */
export function serializarNota(nota: NotaMd): string {
  const lineas = [
    '---',
    `name: ${JSON.stringify(nota.nombre)}`,
    `description: ${JSON.stringify(nota.descripcion)}`,
    'metadata:',
    `  type: ${escribirValorMeta(nota.tipo)}`,
    ...Object.entries(nota.meta).map(([k, v]) => `  ${k}: ${escribirValorMeta(v)}`),
    '---',
    '',
    nota.cuerpo,
    ''
  ]
  return lineas.join('\n')
}

// ---------------------------------------------------------------------------------------------
// Tipos de Claude ↔ tipos de Orbe
// ---------------------------------------------------------------------------------------------

const DE_CLAUDE: Record<string, TipoMemoria> = {
  user: 'usuario',
  feedback: 'preferencia',
  project: 'proyecto'
}

export function tipoDeOrbe(tipoClaude: string): TipoMemoria {
  return DE_CLAUDE[tipoClaude.toLowerCase()] ?? 'nota'
}

export function tipoParaArchivo(tipo: TipoMemoria): string {
  return { usuario: 'user', preferencia: 'feedback', proyecto: 'project', nota: 'note' }[tipo]
}

export const ETIQUETA_TIPO: Record<TipoMemoria, string> = {
  usuario: 'Perfil',
  preferencia: 'Preferencia',
  proyecto: 'Proyecto',
  nota: 'Nota'
}

/** Nombre de archivo seguro: minúsculas, sin acentos, solo letras, números, guion y guion bajo. */
export function aSlug(texto: string, max = 60): string {
  const limpio = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, max)
    .replace(/[-_]+$/g, '')
  return limpio || 'nota'
}

export const ID_VALIDO = /^[a-z0-9][a-z0-9_-]{0,79}$/
