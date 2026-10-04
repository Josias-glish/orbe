/**
 * Preparación del texto para leerlo en voz alta: quita el Markdown, se salta los bloques de código (no tiene
 * sentido deletrearlos) y lo parte en frases. Funciona sobre el texto que va llegando en streaming, para
 * empezar a hablar en cuanto hay una frase completa sin esperar al final de la respuesta.
 */

export interface EstadoLectura {
  dentroCodigo: boolean
  /** Ya se avisó de que hay un bloque de código en esta respuesta (solo se avisa una vez). */
  avisadoCodigo: boolean
}

export const estadoLecturaInicial = (): EstadoLectura => ({ dentroCodigo: false, avisadoCodigo: false })

export const AVISO_CODIGO = 'Hay un bloque de código en el mensaje.'
const LARGO_MAX_FRASE = 260

/** Una línea de Markdown como se leería en voz alta: sin marcas, enlaces ni direcciones. */
export function limpiarMarkdownLinea(linea: string): string {
  return linea
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>+\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*[-=_*]{3,}\s*$/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'enlace')
    .replace(/<[^>]+>/g, ' ')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Parte una frase demasiado larga por comas o puntos y coma, para que la voz no se atragante. */
function partirLarga(frase: string): string[] {
  if (frase.length <= LARGO_MAX_FRASE) return [frase]
  const trozos: string[] = []
  let actual = ''
  for (const parte of frase.split(/(?<=[,;:])\s+/)) {
    if (actual && actual.length + parte.length + 1 > LARGO_MAX_FRASE) {
      trozos.push(actual)
      actual = parte
    } else {
      actual = actual ? `${actual} ${parte}` : parte
    }
  }
  if (actual) trozos.push(actual)
  return trozos.flatMap((t) => (t.length > LARGO_MAX_FRASE * 1.5 ? (t.match(new RegExp(`.{1,${LARGO_MAX_FRASE}}(?:\\s|$)`, 'g')) ?? [t]).map((x) => x.trim()) : [t]))
}

/** Divide un texto ya limpio en frases (solo corta en un punto, signo de cierre o puntos suspensivos seguido de espacio). */
export function dividirFrases(texto: string): string[] {
  return texto
    .split(/(?<=[.!?…])\s+/)
    .map((f) => f.trim())
    .filter((f) => /[\p{L}\p{N}]/u.test(f))
    .flatMap(partirLarga)
}

/** Posición justo después de la última frase terminada (punto + espacio) del texto, o 0 si no hay ninguna. */
function finDeUltimaFrase(texto: string): number {
  let fin = 0
  for (const m of texto.matchAll(/[.!?…]["')\]»”]*\s+/g)) fin = m.index + m[0].length
  return fin
}

/**
 * Saca del texto acumulado las frases ya completas, listas para hablar. Devuelve también lo que sobra (una frase a
 * medias) para volver a llamarla cuando llegue más texto. Con `final` se suelta todo, incluso lo incompleto.
 * `estado` recuerda si se está dentro de un bloque de código entre llamadas.
 */
export function extraerFrases(texto: string, estado: EstadoLectura, final = false): { frases: string[]; resto: string } {
  const frases: string[] = []
  let resto = texto

  const añadir = (t: string): void => {
    const limpio = limpiarMarkdownLinea(t)
    if (limpio) frases.push(...dividirFrases(limpio))
  }

  for (;;) {
    const salto = resto.indexOf('\n')
    if (salto < 0) {
      if (estado.dentroCodigo) {
        if (final) resto = ''
        break
      }
      if (/^\s*```/.test(resto)) {
        // La marca de un bloque de código que aún no ha terminado de llegar.
        if (final) resto = ''
        break
      }
      // Línea sin terminar: se sueltan las frases que ya están completas y se guarda el resto.
      const fin = finDeUltimaFrase(resto)
      if (fin > 0) {
        añadir(resto.slice(0, fin))
        resto = resto.slice(fin)
      }
      if (final && resto.trim()) {
        añadir(resto)
        resto = ''
      }
      break
    }
    const linea = resto.slice(0, salto)
    resto = resto.slice(salto + 1)
    if (/^\s*```/.test(linea)) {
      if (!estado.dentroCodigo && !estado.avisadoCodigo) {
        frases.push(AVISO_CODIGO)
        estado.avisadoCodigo = true
      }
      estado.dentroCodigo = !estado.dentroCodigo
      continue
    }
    if (!estado.dentroCodigo) añadir(linea)
  }
  return { frases, resto }
}

/** Todo un texto de golpe (por ejemplo, para el botón de probar la voz o leer un mensaje entero). */
export function textoParaVoz(markdown: string): string[] {
  const estado = estadoLecturaInicial()
  return extraerFrases(markdown, estado, true).frases
}
