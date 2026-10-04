/** Solo se abren enlaces web normales; nada de file:, javascript: ni protocolos de aplicaciones. */
export function esEnlaceSeguro(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2048) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}
