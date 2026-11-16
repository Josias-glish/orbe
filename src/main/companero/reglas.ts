import { TIPOS_COMENTARIO, type TipoComentario } from '../../shared/companero'
import type { VentanaUia } from '../pantalla/contexto'

type Ventana = Pick<VentanaUia, 'proceso' | 'titulo' | 'url' | 'aplicacion'>

const minusculas = (v: Ventana): string => `${v.proceso} ${v.titulo} ${v.url ?? ''} ${v.aplicacion}`.toLowerCase()

/** En una llamada o reunión, el Compañero calla. */
export function esLlamada(v: Ventana): boolean {
  return /\b(teams|ms-teams|zoom|webex|skype|discord)\b|meet\.google\.com|\breuni[oó]n\b|\bmeeting\b/.test(minusculas(v))
}

/**
 * Correo, mensajería y redes personales: el prompt ya le dice que calle, pero un modelo de 3B no siempre obedece
 * (Gmail dio un «dato curioso» en la prueba real), así que aquí ni se le pregunta.
 */
export function esIntima(v: Ventana): boolean {
  return /\b(outlook|thunderbird|whatsapp|telegram|signal|messenger|olk|hxoutlook|gmail)\b|mail\.google\.com|outlook\.(live|office)\.com|web\.whatsapp\.com|instagram\.com\/direct|facebook\.com\/messages/.test(
    minusculas(v)
  )
}

/** Reproductores y webs de vídeo: modo película (por el proceso o la web, no por la imagen). */
export function esVideo(v: Ventana): boolean {
  return /\b(vlc|mpc-hc|mpc-be|potplayer|mpv|wmplayer|video\.ui)\b|youtube\.com\/watch|netflix\.com\/watch|primevideo\.com|disneyplus\.com|max\.com|crunchyroll\.com|twitch\.tv/.test(
    minusculas(v)
  )
}

/**
 * El título de la obra a partir del de la ventana: «Interstellar (2014).mkv - VLC» → «Interstellar».
 * Vacío si no queda nada que parezca un título (la portada de Netflix, «YouTube» a secas…).
 */
export function tituloObra(titulo: string): string {
  const t = titulo
    .replace(/\s+[-–—|]\s+(vlc media player|vlc|youtube|netflix|prime video|disney\+|max|crunchyroll|twitch|reproductor multimedia|películas y tv|google chrome|microsoft edge|mozilla firefox|opera|brave)\b.*$/i, '')
    .replace(/\.(mkv|mp4|avi|mov|webm|m4v)$/i, '')
    .replace(/[._]/g, ' ')
    .replace(/\(?\b(19|20)\d{2}\b\)?.*$/, '')
    .replace(/\b(1080p|720p|2160p|4k|bluray|web-?dl|x26[45]|hevc)\b.*$/i, '')
    .replace(/^\(\d+\)\s*/, '')
    .trim()
  return t.length >= 2 && !/^(youtube|netflix|prime video|disney\+|inicio|home)$/i.test(t) ? t.slice(0, 100) : ''
}

/** ¿Es hora de silencio? «22:00-07:00» cruza la medianoche. */
export function enSilencio(silencio: string, ahora: Date): boolean {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(silencio)
  if (!m) return false
  const desde = Number(m[1]) * 60 + Number(m[2])
  const hasta = Number(m[3]) * 60 + Number(m[4])
  const min = ahora.getHours() * 60 + ahora.getMinutes()
  return desde <= hasta ? min >= desde && min < hasta : min >= desde || min < hasta
}

export interface Propuesta {
  tipo: TipoComentario
  texto: string
}

/** La respuesta del modelo (prompt C.2), con los filtros de C.2: comentar, tipo válido, ≤ 25 palabras y confianza ≥ 0,7. */
export function validarComentario(respuesta: string): Propuesta | null {
  const bloque = /\{[\s\S]*\}/.exec(respuesta)
  if (!bloque) return null
  let d: Record<string, unknown>
  try {
    d = JSON.parse(bloque[0]) as Record<string, unknown>
  } catch {
    return null
  }
  const texto = typeof d['texto'] === 'string' ? d['texto'].trim().replace(/\s+/g, ' ') : ''
  const tipo = d['tipo']
  if (d['comentar'] !== true || !texto || !(TIPOS_COMENTARIO as readonly unknown[]).includes(tipo)) return null
  if (typeof d['confianza'] !== 'number' || d['confianza'] < 0.7) return null
  if (texto.split(' ').length > 25) return null
  return { tipo: tipo as TipoComentario, texto }
}

/** Para no repetirse: mismo texto sin mayúsculas, tildes ni signos. */
export function huellaTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export const MIN = 60_000

export interface Ritmo {
  /** Momentos de los comentarios mostrados en la última hora. */
  hechos: number[]
  /** Comentarios seguidos que se fueron solos, sin que los tocaras. */
  ignorados: number
}

/**
 * ¿Puede comentar ya? Máximo `maxHora` por hora, 10 min entre comentarios (15 en modo película) y, si ignoraste
 * 2 seguidos, el doble de espera.
 */
export function puedeComentar(r: Ritmo, ahora: number, maxHora: number, pelicula: boolean): boolean {
  const hora = r.hechos.filter((t) => ahora - t < 60 * MIN)
  if (hora.length >= maxHora) return false
  const ultimo = Math.max(0, ...hora)
  const espera = (pelicula ? 15 : 10) * MIN * (r.ignorados >= 2 ? 2 : 1)
  return ahora - ultimo >= espera
}
