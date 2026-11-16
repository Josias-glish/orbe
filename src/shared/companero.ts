/** Compañero (Etapa 14): comentarios espontáneos sobre lo que haces, hechos por un modelo local sin herramientas. */

export const TIPOS_COMENTARIO = ['dato_curioso', 'recomendacion', 'animo', 'descanso'] as const
export type TipoComentario = (typeof TIPOS_COMENTARIO)[number]

export interface ComentarioCompanero {
  id: string
  texto: string
  tipo: TipoComentario
  /** La app sobre la que comenta (para «Esto no»). */
  app: string
  /** Modo película: bocadillo más discreto y que se va antes. */
  pelicula: boolean
  /** ORBE_COMPANERO_VOZ=1 y fuera del modo película: además se dice en voz alta. */
  voz?: boolean
}

export type AccionBocadillo = 'profundizar' | 'esto_no' | 'cerrar' | 'ignorado'
export const ACCIONES_BOCADILLO: readonly AccionBocadillo[] = ['profundizar', 'esto_no', 'cerrar', 'ignorado']

/** El borrador que [Profundizar] deja en el chat: lo ves antes de enviarlo al cerebro profundo. */
export function borradorProfundizar(c: Pick<ComentarioCompanero, 'texto' | 'app'>): string {
  return `Cuéntame más sobre esto que me comentaste mientras usaba ${c.app}: «${c.texto}»`
}
