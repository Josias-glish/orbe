/**
 * Qué es cada acción de Composio para `reglas.json`, decidido por su nombre (`TOOLKIT_VERBO_OBJETO`, p. ej.
 * `GOOGLECALENDAR_LIST_EVENTS`): leer va libre; todo lo demás (crear, enviar, publicar, borrar…) se hace, pero
 * pidiendo permiso en ese momento.
 */
export type AccionComposio = 'composio.leer' | 'composio.escribir'

const LECTURA = new Set(['GET', 'LIST', 'FETCH', 'SEARCH', 'FIND', 'READ', 'RETRIEVE', 'QUERY', 'DESCRIBE', 'COUNT', 'LOOKUP', 'VIEW'])

/** El toolkit de un slug: lo que va antes del primer «_», en minúsculas. */
export const toolkitDe = (slug: string): string => (slug.split('_')[0] ?? '').toLowerCase()

export function clasificarAccion(slug: string): AccionComposio {
  // ponytail: solo mira el primer verbo; un slug raro («NOTION_PAGE_GET») cae en «escribir» y pide permiso, que es lo seguro.
  return LECTURA.has(slug.toUpperCase().split('_')[1] ?? '') ? 'composio.leer' : 'composio.escribir'
}
