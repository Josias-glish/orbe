/** Reglas de red del agente: qué direcciones puede abrir. Las reutilizará el navegador controlado. */

/** `invalida`: no se entiende la dirección (el modelo puede corregirla); `prohibida`: se entiende y no se puede abrir. */
export type ResultadoUrl = { ok: true; url: URL } | { ok: false; tipo: 'invalida' | 'prohibida'; motivo: string }

const MAX_URL = 2048

/** Sufijos de nombres que solo existen dentro de una red privada o en este equipo. */
const SUFIJOS_LOCALES = ['localhost', 'local', 'localdomain', 'internal', 'intranet', 'lan', 'home', 'corp', 'private', 'home.arpa']

function ipv4EsPrivada(octetos: number[]): boolean {
  const [a, b, c] = octetos
  return (
    a === 0 || // «esta red»
    a === 10 ||
    a === 127 || // este equipo
    (a === 100 && b >= 64 && b <= 127) || // compartida de operadores (CGNAT)
    (a === 169 && b === 254) || // enlace local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // pruebas de rendimiento
    a >= 224 // multidifusión y reservadas
  )
}

/** Despliega una dirección IPv6 a sus ocho grupos de 16 bits; null si no es una IPv6 válida. */
function expandirIpv6(texto: string): number[] | null {
  let t = texto.toLowerCase()
  // Un IPv4 al final (::ffff:1.2.3.4) ocupa los dos últimos grupos.
  const cuarteto = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(t)
  if (cuarteto) {
    const o = cuarteto.slice(1).map(Number)
    if (o.some((n) => n > 255)) return null
    t = `${t.slice(0, cuarteto.index)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`
  }
  const partes = t.split('::')
  if (partes.length > 2) return null
  const grupos = (s: string): string[] => (s === '' ? [] : s.split(':'))
  const cabeza = grupos(partes[0])
  const cola = partes.length === 2 ? grupos(partes[1]) : []
  const faltan = 8 - cabeza.length - cola.length
  if (partes.length === 1 ? faltan !== 0 : faltan < 1) return null
  const todos = [...cabeza, ...Array<string>(partes.length === 2 ? faltan : 0).fill('0'), ...cola]
  if (todos.length !== 8 || todos.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return todos.map((g) => parseInt(g, 16))
}

function ipv6EsPrivada(texto: string): boolean {
  const g = expandirIpv6(texto)
  if (!g) return true // si no se entiende, no se arriesga
  const ceros = (desde: number, hasta: number): boolean => g.slice(desde, hasta).every((x) => x === 0)
  if (ceros(0, 7) && g[7] <= 1) return true // :: y ::1
  if ((g[0] & 0xffc0) === 0xfe80) return true // enlace local
  if ((g[0] & 0xfe00) === 0xfc00) return true // privada única
  if ((g[0] & 0xff00) === 0xff00) return true // multidifusión
  const dentro = (a: number, b: number): boolean => ipv4EsPrivada([a >> 8, a & 255, b >> 8, b & 255])
  if (ceros(0, 5) && g[5] === 0xffff) return dentro(g[6], g[7]) // IPv4 mapeada en IPv6
  if (ceros(0, 6)) return dentro(g[6], g[7]) // IPv4 «compatible» (obsoleta)
  if (g[0] === 0x64 && g[1] === 0xff9b && ceros(2, 6)) return dentro(g[6], g[7]) // NAT64
  if (g[0] === 0x2002) return dentro(g[1], g[2]) // 6to4: lleva un IPv4 incrustado
  return false
}

/** ¿El nombre de host apunta a este equipo o a una red privada? Las IP llegan ya normalizadas por `URL`. */
export function esHostLocal(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (h === '') return true
  if (h.startsWith('[') && h.endsWith(']')) return ipv6EsPrivada(h.slice(1, -1))
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h)
  if (v4) return ipv4EsPrivada(v4.slice(1).map(Number))
  if (!h.includes('.')) return true // «router», «intranet»: nombres de la red interna
  return SUFIJOS_LOCALES.some((s) => h === s || h.endsWith(`.${s}`))
}

/** «example.com/ruta» sin esquema es una dirección web; «javascript:…», «mailto:…» o «localhost:3000» no. */
function conEsquema(texto: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(texto)) return texto
  return /^[^\s/:?#@]+\.[^\s/:?#@]+(:\d+)?([/?#].*)?$/.test(texto) ? `https://${texto}` : texto
}

/**
 * Comprueba que una dirección es una página web que se puede abrir: http o https, sin usuario ni contraseña (el truco de
 * las páginas falsas) y, salvo permiso del usuario, que no apunta a este equipo ni a la red local.
 */
export function analizarUrlWeb(texto: string, { permitirLocal }: { permitirLocal: boolean }): ResultadoUrl {
  const limpio = texto.trim()
  if (limpio === '' || limpio.length > MAX_URL) return { ok: false, tipo: 'invalida', motivo: 'La dirección está vacía o es demasiado larga.' }
  let url: URL
  try {
    url = new URL(conEsquema(limpio))
  } catch {
    return { ok: false, tipo: 'invalida', motivo: 'No es una dirección web válida. Escríbela completa, con https://.' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      tipo: 'prohibida',
      motivo: 'Solo abro direcciones web (http o https): no abro archivos, la configuración del sistema ni enlaces de otras aplicaciones.'
    }
  }
  if (url.username || url.password) {
    return { ok: false, tipo: 'prohibida', motivo: 'La dirección lleva usuario y contraseña delante, un truco típico de las páginas falsas.' }
  }
  if (!permitirLocal && esHostLocal(url.hostname)) {
    return { ok: false, tipo: 'prohibida', motivo: 'Esa dirección apunta a este equipo o a la red local, y no tengo permiso para abrirla.' }
  }
  return { ok: true, url }
}
