/** Decisiones sencillas sobre el texto leído de la pantalla. */

/** Letras y dígitos de cualquier idioma. */
export function contarLetras(texto: string): number {
  const m = texto.match(/[\p{L}\p{N}]/gu)
  return m ? m.length : 0
}

export const MINIMO_LETRAS_UTIL = 120
export const MINIMO_PALABRAS_UTIL = 15

/**
 * ¿Hay texto suficiente para entender de qué va la ventana? Una ventana con solo botones y menús
 * («Archivo Editar Ver») no lo es: ahí una captura de pantalla ayudaría más.
 */
export function contenidoUtil(texto: string | null | undefined): boolean {
  if (!texto) return false
  if (contarLetras(texto) < MINIMO_LETRAS_UTIL) return false
  return texto.split(/\s+/).filter(Boolean).length >= MINIMO_PALABRAS_UTIL
}
