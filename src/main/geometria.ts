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

/** Lo que la ventana expandida mide de más que el panel: la parte del orbe (624 - 520). */
export const ALTO_EXTRA_ORBE = 104
export const TAM_PANEL_POR_DEFECTO = { ancho: 380, alto: 520 }
export const TAM_PANEL_MIN = { ancho: 340, alto: 380 }
export const TAM_PANEL_MAX = { ancho: 800, alto: 1000 }

export interface TamPanel {
  ancho: number
  alto: number
}

/** Tamaño de la ventana expandida para un panel de ese tamaño. */
export function tamVentanaExpandida(panel: TamPanel): { width: number; height: number } {
  return { width: panel.ancho, height: panel.alto + ALTO_EXTRA_ORBE }
}

/** Tamaño del panel que corresponde a una ventana expandida. */
export function panelDeVentana(ventana: Rect): TamPanel {
  return { ancho: ventana.width, alto: ventana.height - ALTO_EXTRA_ORBE }
}

/** Mantiene el tamaño del panel entre el mínimo y el máximo, y dentro de lo que cabe en el área de trabajo. */
export function limitarPanel(panel: TamPanel, area: Rect): TamPanel {
  const maxAncho = Math.max(TAM_PANEL_MIN.ancho, Math.min(TAM_PANEL_MAX.ancho, area.width))
  const maxAlto = Math.max(TAM_PANEL_MIN.alto, Math.min(TAM_PANEL_MAX.alto, area.height - ALTO_EXTRA_ORBE))
  return {
    ancho: Math.round(Math.min(maxAncho, Math.max(TAM_PANEL_MIN.ancho, panel.ancho))),
    alto: Math.round(Math.min(maxAlto, Math.max(TAM_PANEL_MIN.alto, panel.alto)))
  }
}

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
 * `panel` es el tamaño que eligió el usuario (por defecto, 380×520).
 */
export function disposicionExpandida(
  colapsado: Rect,
  area: Rect,
  panel: TamPanel = TAM_PANEL_POR_DEFECTO
): DisposicionExpandida {
  const tam = tamVentanaExpandida(limitarPanel(panel, area))
  const centroX = colapsado.x + colapsado.width / 2
  const centroY = colapsado.y + colapsado.height / 2
  const enMitadDerecha = centroX > area.x + area.width / 2
  const enMitadInferior = centroY > area.y + area.height / 2

  const x = enMitadDerecha ? colapsado.x + colapsado.width - tam.width : colapsado.x
  const y = enMitadInferior ? colapsado.y + colapsado.height - tam.height : colapsado.y

  return {
    bounds: dentroDe({ ...tam, x, y }, area),
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

/** Qué ejes cambia un arrastre: solo el ancho, solo el alto o ambos (la esquina). */
export type ModoRedimension = 'x' | 'y' | 'xy'

/**
 * Nuevo rectángulo de la ventana expandida al arrastrar un borde del panel. El orbe no se mueve: la esquina
 * de anclaje queda fija y el panel crece o se encoge hacia el lado contrario. `delta` es lo que se ha movido
 * el puntero desde el inicio del arrastre. Respeta el mínimo, el máximo y el área de trabajo.
 */
export function redimensionar(
  inicial: Rect,
  ancla: DisposicionExpandida['ancla'],
  delta: { dx: number; dy: number },
  modo: ModoRedimension,
  area: Rect
): Rect {
  const derecha = ancla.horizontal === 'derecha'
  const abajo = ancla.vertical === 'abajo'

  // Lo máximo que puede medir sin salirse del área, contando desde la esquina fija.
  const espacioAncho = derecha ? inicial.x + inicial.width - area.x : area.x + area.width - inicial.x
  const espacioAlto = abajo ? inicial.y + inicial.height - area.y : area.y + area.height - inicial.y
  const minAlto = TAM_PANEL_MIN.alto + ALTO_EXTRA_ORBE
  const maxAncho = Math.max(TAM_PANEL_MIN.ancho, Math.min(TAM_PANEL_MAX.ancho, espacioAncho))
  const maxAlto = Math.max(minAlto, Math.min(TAM_PANEL_MAX.alto + ALTO_EXTRA_ORBE, espacioAlto))

  const queAncho = modo === 'y' ? inicial.width : inicial.width + (derecha ? -delta.dx : delta.dx)
  const queAlto = modo === 'x' ? inicial.height : inicial.height + (abajo ? -delta.dy : delta.dy)
  const width = Math.round(Math.min(maxAncho, Math.max(TAM_PANEL_MIN.ancho, queAncho)))
  const height = Math.round(Math.min(maxAlto, Math.max(minAlto, queAlto)))

  return {
    width,
    height,
    x: derecha ? inicial.x + inicial.width - width : inicial.x,
    y: abajo ? inicial.y + inicial.height - height : inicial.y
  }
}
