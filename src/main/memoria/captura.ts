/**
 * Órdenes de memoria escritas por el usuario («recuerda que…»). Se detectan con reglas fijas, no con el
 * modelo: así solo lo que la persona teclea puede entrar en la memoria, y nunca el texto de una página
 * o de un documento que Orbe haya leído de la pantalla.
 */

export interface OrdenRecordar {
  /** Lo que hay que recordar, ya limpio y con la primera letra en mayúscula. */
  hecho: string
}

export const MAX_HECHO = 400

const RELLENO = String.raw`(?:(?:oye|ey|hola|vale|orbe|ok|por\s+favor|porfa|a\s+ver)\b[\s,.:;!-]*)*`

/** Disparadores con «que» o dos puntos: «recuerda que…», «ten en cuenta que…», «guarda en tu memoria que…». */
const DISPARADOR = new RegExp(
  String.raw`^${RELLENO}(?:` +
    String.raw`recuerda(?:\s+(?:esto|lo\s+siguiente))?\s*(?:que\b|:)|` +
    String.raw`ten\s+(?:en\s+cuenta|presente)\s+que\b|` +
    String.raw`no\s+(?:te\s+)?olvid(?:es|e)\s+(?:de\s+)?que\b|` +
    String.raw`acu[eé]rdate\s+(?:de\s+)?que\b|` +
    String.raw`memoriza\s*(?:que\b|:)|` +
    String.raw`(?:apunta|anota)\s*(?:que\b|:)|` +
    String.raw`(?:guarda|apunta|anota)\s+en\s+(?:tu|la)\s+memoria\s*(?:que\b|:)|` +
    String.raw`remember\s*(?:that\b|:)` +
    String.raw`)\s*`,
  'i'
)

/**
 * ¿El mensaje entero es una orden de recordar un dato? Es conservador a propósito: si lleva una pregunta
 * o varias frases (por ejemplo «recuerda que… ¿cómo hago…?»), es una conversación y no se guarda nada;
 * para eso está el gestor de memoria.
 */
export function detectarOrdenRecordar(texto: string): OrdenRecordar | null {
  const t = texto.trim()
  if (!t || /[?¿]/.test(t)) return null
  if (t.split(/\r?\n/).filter((l) => l.trim()).length > 2) return null

  const m = DISPARADOR.exec(t)
  if (!m) return null

  let hecho = t.slice(m[0].length).replace(/\s+/g, ' ').trim()
  hecho = hecho.replace(/^["'«“]+|["'»”]+$/g, '').trim()
  // Varias frases: lo que sigue a la primera ya no es parte del dato.
  if (/[.!;]\s+\S/.test(hecho)) return null
  hecho = hecho.replace(/[.!;]+$/, '').trim()
  if (hecho.length < 3 || hecho.length > MAX_HECHO) return null

  return { hecho: hecho[0].toUpperCase() + hecho.slice(1) }
}
