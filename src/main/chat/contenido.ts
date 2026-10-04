import type { ContextoPantalla } from '../../shared/tipos'

/** Un turno del usuario: su pregunta y, solo si la pidió, lo que hay en su pantalla. */
export interface TurnoEntrada {
  texto: string
  contexto?: ContextoPantalla
}

/** Bloques de contenido; la forma es idéntica para la API de Anthropic y para el stream-json del CLI. */
export type BloqueEntrada =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png'; data: string } }

const ETIQUETAS_PROPIAS = /<(\/?)(contexto_pantalla|ventana|seleccion|contenido_ventana|captura)\b/gi

/** Evita que el contenido de la pantalla cierre o abra nuestras etiquetas (un texto hostil podría intentarlo). */
export function neutralizarEtiquetas(texto: string): string {
  return texto.replace(ETIQUETAS_PROPIAS, '‹$1$2')
}

function escaparAtributo(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Texto del bloque `<contexto_pantalla>`; vacío si no hay contexto textual ni imagen que anunciar. */
export function describirContexto(contexto: ContextoPantalla | undefined): string {
  if (!contexto) return ''
  const partes: string[] = []

  if (contexto.ventana) {
    const { aplicacion, titulo, url } = contexto.ventana
    const atributos = [`aplicacion="${escaparAtributo(aplicacion)}"`, `titulo="${escaparAtributo(titulo)}"`]
    if (url) atributos.push(`url="${escaparAtributo(url)}"`)
    partes.push(`<ventana ${atributos.join(' ')}/>`)
  }
  if (contexto.seleccion) {
    partes.push(`<seleccion>\n${neutralizarEtiquetas(contexto.seleccion)}\n</seleccion>`)
  }
  if (contexto.contenido) {
    partes.push(`<contenido_ventana>\n${neutralizarEtiquetas(contexto.contenido)}\n</contenido_ventana>`)
  }
  if (contexto.imagen) {
    partes.push('<captura>Se adjunta una captura de la pantalla del usuario.</captura>')
  }
  if (partes.length === 0) return ''
  return `<contexto_pantalla>\n${partes.join('\n')}\n</contexto_pantalla>`
}

/** Construye el contenido del mensaje: imagen primero (si la hay), luego contexto y pregunta. */
export function construirBloques(turno: TurnoEntrada): BloqueEntrada[] {
  const bloques: BloqueEntrada[] = []
  const imagen = turno.contexto?.imagen
  if (imagen) {
    bloques.push({ type: 'image', source: { type: 'base64', media_type: imagen.tipoMime, data: imagen.base64 } })
  }
  const contexto = describirContexto(turno.contexto)
  bloques.push({ type: 'text', text: contexto ? `${contexto}\n\n${turno.texto}` : turno.texto })
  return bloques
}
