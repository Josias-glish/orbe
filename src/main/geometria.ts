/** Lógica pura de posicionamiento de la ventana (sin dependencias de Electron, para poder probarla). */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const TAM_COLAPSADO = { width: 120, height: 120 }
/**
 * Panel de 380×520 más la caja del orbe (120). Se solapan 16 px, que es margen transparente del
 * orbe, así que entre el panel y la esfera queda un hueco visible de unos 8 px.
 */
export const TAM_EXPANDIDO = { width: 380, height: 624 }
export const MARGEN_ESQUINA = 16

/**
 * Mantiene un rectángulo dentro del área, desplazándolo lo mínimo. Si el rectángulo es mayor que
 * el área (pantalla muy pequeña), gana la esquina superior izquierda, donde está la cabecera.
 */
export function dentroDe(rect: Rect, area: Rect): Rect {
  const x = Math.max(area.x, Math.min(rect.x, area.x + area.width - rect.width))
  const y = Math.max(area.y, Math.min(rect.y, area.y + area.height - rect.height))
  return { ...rect, x, y }
}

/** Esquina inferior derecha del área de trabajo, con un pequeño margen. */
export function posicionPorDefecto(area: Rect): Rect {
  return {
    ...TAM_COLAPSADO,
    x: area.x + area.width - TAM_COLAPSADO.width - MARGEN_ESQUINA,
    y: area.y + area.height - TAM_COLAPSADO.height - MARGEN_ESQUINA
  }
}

export interface DisposicionExpandida {
  bounds: Rect
  ancla: { horizontal: 'izquierda' | 'derecha'; vertical: 'arriba' | 'abajo' }
}

/**
 * Calcula dónde queda el panel al expandir. El orbe permanece donde está y el panel crece
 * hacia el centro del área de trabajo, de modo que el orbe queda en la esquina más cercana al borde.
 */
export function disposicionExpandida(colapsado: Rect, area: Rect): DisposicionExpandida {
  const centroX = colapsado.x + colapsado.width / 2
  const centroY = colapsado.y + colapsado.height / 2
  const enMitadDerecha = centroX > area.x + area.width / 2
  const enMitadInferior = centroY > area.y + area.height / 2

  const x = enMitadDerecha ? colapsado.x + colapsado.width - TAM_EXPANDIDO.width : colapsado.x
  const y = enMitadInferior ? colapsado.y + colapsado.height - TAM_EXPANDIDO.height : colapsado.y

  return {
    bounds: dentroDe({ ...TAM_EXPANDIDO, x, y }, area),
    ancla: {
      horizontal: enMitadDerecha ? 'derecha' : 'izquierda',
      vertical: enMitadInferior ? 'abajo' : 'arriba'
    }
  }
}

/** Operación inversa: dado el panel expandido y su ancla, devuelve el rectángulo colapsado. */
export function rectColapsadoDesde(expandido: Rect, ancla: DisposicionExpandida['ancla']): Rect {
  const x = ancla.horizontal === 'derecha' ? expandido.x + expandido.width - TAM_COLAPSADO.width : expandido.x
  const y = ancla.vertical === 'abajo' ? expandido.y + expandido.height - TAM_COLAPSADO.height : expandido.y
  return { ...TAM_COLAPSADO, x, y }
}
