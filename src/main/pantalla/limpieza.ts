/** Limpieza del texto leído de la pantalla y de las direcciones web, antes de enseñarlo o enviarlo. */

export interface TextoLimpio {
  texto: string
  /** Se cortó para respetar el máximo. */
  recortado: boolean
  /** Longitud del texto ya limpio, antes de recortar. */
  caracteresOriginales: number
}

// Caracteres de control y marcas invisibles (ancho cero, direccionales…) que no aportan nada al modelo.
// eslint-disable-next-line no-control-regex
const INVISIBLES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\uFEFF]/g

/**
 * Normaliza saltos de línea (Notepad devuelve «\r»), quita invisibles y espacios sobrantes al final de
 * cada línea, comprime las líneas en blanco y recorta a `max` caracteres cortando en un salto de línea.
 */
export function limpiarTexto(bruto: string, max: number): TextoLimpio {
  const texto = bruto
    .replace(/\r\n?/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(INVISIBLES, '')

  const lineas: string[] = []
  let enBlanco = 0
  for (const linea of texto.split('\n')) {
    const limpia = linea.replace(/[ \t]+$/g, '')
    if (limpia.trim() === '') {
      if (++enBlanco <= 1) lineas.push('')
    } else {
      enBlanco = 0
      lineas.push(limpia)
    }
  }
  const completo = lineas.join('\n').trim()
  if (completo.length <= max) return { texto: completo, recortado: false, caracteresOriginales: completo.length }

  // Se prefiere cortar en un salto de línea si está razonablemente cerca del límite.
  let corte = completo.lastIndexOf('\n', max)
  if (corte < max * 0.8) corte = max
  // No partir un par sustituto (emoji) por la mitad.
  const codigo = completo.charCodeAt(corte - 1)
  if (codigo >= 0xd800 && codigo <= 0xdbff) corte--
  return { texto: completo.slice(0, corte).trimEnd(), recortado: true, caracteresOriginales: completo.length }
}

export interface UrlSaneada {
  url: string
  /** Se quitaron la consulta (?…), el fragmento (#…) o las credenciales, que pueden llevar datos personales. */
  parametrosOmitidos: boolean
}

/**
 * Deja solo esquema, sitio y ruta. Las direcciones suelen llevar identificadores de sesión, tokens o
 * búsquedas privadas en la consulta; el modelo no los necesita.
 */
export function sanearUrl(url: string | null | undefined): UrlSaneada | null {
  if (!url) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const tieneCredenciales = u.username !== '' || u.password !== ''
  const omitidos = tieneCredenciales || u.search !== '' || u.hash !== ''
  u.username = ''
  u.password = ''
  u.search = ''
  u.hash = ''
  return { url: u.href, parametrosOmitidos: omitidos }
}

/**
 * La barra de direcciones de Chrome y Edge muestra «example.com/ruta» sin «https://» y las rutas de
 * archivo como «C:/Users/…». Esto lo convierte en una URL completa; devuelve null si no lo parece.
 */
export function normalizarBarra(barra: string | null | undefined): string | null {
  if (!barra) return null
  const v = barra.trim()
  if (!v || /\s/.test(v)) return null
  if (/^[A-Za-z]:[\\/]/.test(v)) return `file:///${v.replace(/\\/g, '/')}`
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^(about|chrome|edge|view-source):/i.test(v)) return v
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3}|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#]|$)/i.test(v)) return `https://${v}`
  return null
}

/** Recorta para mostrar: «texto…». */
export function vistaPrevia(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max).trimEnd()}…`
}
