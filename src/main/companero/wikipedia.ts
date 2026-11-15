import type { Pedir } from './voz'

/**
 * Ficha de una obra en Wikipedia en español (modo «equilibrado»): sale SOLO el título, siempre con la misma petición.
 * El Compañero no navega ni tiene herramientas: esto lo hace el código y el resumen le llega como dato.
 * API REST de Wikimedia, /page/summary (comprobada el 12-nov con «Interstellar»).
 */
const cache = new Map<string, string | null>()

export async function fichaWikipedia(titulo: string, pedir: Pedir = fetch): Promise<string | null> {
  const t = titulo.trim()
  if (!t) return null
  if (cache.has(t)) return cache.get(t) ?? null
  let ficha: string | null = null
  for (const candidato of [`${t} (película)`, `${t} (serie de televisión)`, `${t} (videojuego)`, t]) {
    try {
      const r = await pedir(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidato.replace(/ /g, '_'))}`, {
        headers: { 'user-agent': 'Orbe (asistente de escritorio)', accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      })
      if (!r.ok) continue
      const d = (await r.json()) as { type?: string; extract?: string }
      if (d.type === 'standard' && d.extract) {
        ficha = d.extract.slice(0, 900)
        break
      }
    } catch {
      // sin red o lento: el Compañero sigue sin ficha
    }
  }
  if (cache.size > 100) cache.clear()
  cache.set(t, ficha)
  return ficha
}
