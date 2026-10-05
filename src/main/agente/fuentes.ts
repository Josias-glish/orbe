import type { FuenteVista } from '../../shared/tipos'
import { esEnlaceSeguro } from '../chat/enlaces'
import { recortar } from './validacion'

/** Cuántos enlaces de fuentes se enseñan bajo una respuesta. */
export const MAX_FUENTES = 8
const MAX_TITULO = 160

export interface FuenteBruta {
  titulo?: unknown
  url?: unknown
}

/** Quita caracteres de control y espacios sobrantes: el título viene de una página y se pinta tal cual en el chat. */
function limpiarTitulo(titulo: unknown): string {
  // eslint-disable-next-line no-control-regex
  return typeof titulo === 'string' ? titulo.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim() : ''
}

/**
 * Deja solo las fuentes que se pueden enseñar con seguridad: enlaces http o https sin usuario ni contraseña,
 * sin repetir y con un título legible (si no hay, el dominio). El orden de llegada se conserva.
 */
export function normalizarFuentes(brutas: readonly FuenteBruta[], max = MAX_FUENTES): FuenteVista[] {
  const vistas = new Set<string>()
  const fuentes: FuenteVista[] = []
  for (const bruta of brutas) {
    if (fuentes.length >= max) break
    if (!esEnlaceSeguro(bruta.url)) continue
    const url = new URL(bruta.url)
    if (url.username || url.password) continue
    url.hash = ''
    const clave = url.href
    if (vistas.has(clave)) continue
    vistas.add(clave)
    const titulo = limpiarTitulo(bruta.titulo)
    fuentes.push({ titulo: recortar(titulo || url.hostname, MAX_TITULO), url: url.href })
  }
  return fuentes
}
