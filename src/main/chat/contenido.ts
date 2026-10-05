import type { ContextoPantalla } from '../../shared/tipos'

/** Un turno del usuario: su pregunta y, solo si la pidió, lo que hay en su pantalla. */
export interface TurnoEntrada {
  texto: string
  contexto?: ContextoPantalla
  /** Lo que quedó de la conversación anterior (solo en el primer mensaje tras volver a abrir Orbe). */
  historialPrevio?: string
  /** Algo que la propia aplicación hizo y el modelo debe saber (p. ej., que guardó una nota en la memoria). */
  notaApp?: string
}

/** Bloques de contenido; la forma es idéntica para la API de Anthropic y para el stream-json del CLI. */
export type BloqueEntrada =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png'; data: string } }

const ETIQUETAS_PROPIAS =
  /<(\/?)(contexto_pantalla|ventana|seleccion|contenido_ventana|captura|memoria|nota_de_la_app|conversacion_anterior|contenido_externo|aviso_app)\b/gi

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
    const recortada = contexto.seleccionRecortada ? ' recortada="true"' : ''
    partes.push(`<seleccion${recortada}>\n${neutralizarEtiquetas(contexto.seleccion)}\n</seleccion>`)
  }
  if (contexto.contenido) {
    const recortado = contexto.contenidoRecortado ? ' recortado="true"' : ''
    partes.push(`<contenido_ventana${recortado}>\n${neutralizarEtiquetas(contexto.contenido)}\n</contenido_ventana>`)
  }
  if (contexto.imagen) {
    partes.push('<captura>Se adjunta una captura de la pantalla del usuario.</captura>')
  }
  if (partes.length === 0) return ''
  return `<contexto_pantalla>\n${partes.join('\n')}\n</contexto_pantalla>`
}

/** Bloque con la conversación anterior; `resumen` ya viene como texto plano de «Usuario: …» y «Orbe: …». */
export function describirHistorialPrevio(historial: string | undefined): string {
  if (!historial?.trim()) return ''
  return `<conversacion_anterior>\n${neutralizarEtiquetas(historial.trim())}\n</conversacion_anterior>`
}

/** Bloque con algo que hizo la aplicación (no el usuario) y que el modelo debe tener en cuenta. */
export function describirNotaApp(nota: string | undefined): string {
  if (!nota?.trim()) return ''
  return `<nota_de_la_app>\n${neutralizarEtiquetas(nota.trim())}\n</nota_de_la_app>`
}

/**
 * Construye el contenido del mensaje: imagen primero (si la hay), luego lo que añade la aplicación
 * (conversación anterior, notas, contexto de pantalla) y por último lo que escribió el usuario.
 * Lo que escribe el usuario también se neutraliza: no puede hacerse pasar por la aplicación.
 */
export function construirBloques(turno: TurnoEntrada): BloqueEntrada[] {
  const bloques: BloqueEntrada[] = []
  const imagen = turno.contexto?.imagen
  if (imagen) {
    bloques.push({ type: 'image', source: { type: 'base64', media_type: imagen.tipoMime, data: imagen.base64 } })
  }
  const delante = [
    describirHistorialPrevio(turno.historialPrevio),
    describirNotaApp(turno.notaApp),
    describirContexto(turno.contexto)
  ].filter(Boolean)
  const texto = delante.length > 0 ? `${delante.join('\n\n')}\n\n${neutralizarEtiquetas(turno.texto)}` : turno.texto
  bloques.push({ type: 'text', text: texto })
  return bloques
}
