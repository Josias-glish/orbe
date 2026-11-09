import type { IdExpresion } from '../../shared/expresiones'

/**
 * Movimientos de todo el cuerpo: el modelo 3D es una sola pieza (sin esqueleto), así que los gestos se hacen moviendo,
 * girando y estirando la figura entera, más una manita dibujada para saludar. Cada gesto dura unos segundos y se
 * mezcla con la respiración, la mirada y el bote de la expresión.
 */
export const IDS_GESTO = ['saludo', 'salto', 'asentir', 'negar', 'giro', 'baile', 'estirarse', 'mirar-alrededor', 'sacudida', 'reverencia'] as const
export type IdGesto = (typeof IDS_GESTO)[number]

export interface Pose {
  /** Radianes. */
  rotX: number
  rotY: number
  rotZ: number
  /** En unidades del modelo (≈ su altura = 1). */
  posX: number
  posY: number
  escalaX: number
  escalaY: number
  /** La manita del saludo: -1…1 es el ángulo del vaivén; null = no se ve. */
  mano: number | null
}

export const POSE_NEUTRA: Pose = { rotX: 0, rotY: 0, rotZ: 0, posX: 0, posY: 0, escalaX: 1, escalaY: 1, mano: null }

export interface DefinicionGesto {
  nombre: string
  emoji: string
  duracionMs: number
  /** La cara que pone mientras lo hace (si no, la que tuviera). */
  expresion?: IdExpresion
}

export const GESTOS: Record<IdGesto, DefinicionGesto> = {
  saludo: { nombre: 'Saludar', emoji: '👋', duracionMs: 2200, expresion: 'feliz' },
  salto: { nombre: 'Saltar', emoji: '🐇', duracionMs: 900, expresion: 'emocionado' },
  asentir: { nombre: 'Asentir', emoji: '👍', duracionMs: 1100 },
  negar: { nombre: 'Negar', emoji: '🙅', duracionMs: 1100 },
  giro: { nombre: 'Dar una vuelta', emoji: '🔄', duracionMs: 1300, expresion: 'risa' },
  baile: { nombre: 'Bailar', emoji: '💃', duracionMs: 2600, expresion: 'emocionado' },
  estirarse: { nombre: 'Estirarse', emoji: '🙆', duracionMs: 1900, expresion: 'aburrido' },
  'mirar-alrededor': { nombre: 'Mirar alrededor', emoji: '👀', duracionMs: 2400, expresion: 'curioso' },
  sacudida: { nombre: 'Sacudirse', emoji: '💫', duracionMs: 800 },
  reverencia: { nombre: 'Reverencia', emoji: '🙇', duracionMs: 1600, expresion: 'orgulloso' }
}

/** Gestos tranquilos que hace solo cuando no pasa nada (para que nunca se quede quieto mucho rato). */
export const GESTOS_OCIOSOS: readonly IdGesto[] = ['mirar-alrededor', 'estirarse', 'asentir', 'baile', 'giro', 'salto', 'sacudida']

const suave = (p: number): number => p * p * (3 - 2 * p)
/** Sube y baja una vez entre 0 y 1 (0 en los extremos). */
const campana = (p: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, p)))

export function esIdGesto(v: unknown): v is IdGesto {
  return typeof v === 'string' && (IDS_GESTO as readonly string[]).includes(v)
}

/** La pose del gesto en el punto `p` (0 = empieza, 1 = termina). Siempre vuelve a la neutra en p = 0 y p = 1. */
export function poseGesto(id: IdGesto, p: number): Pose {
  const x = Math.min(1, Math.max(0, p))
  const r = { ...POSE_NEUTRA }
  const env = campana(x)
  switch (id) {
    case 'saludo':
      // Se inclina hacia la mano y la agita tres veces.
      r.rotZ = -0.12 * env
      r.posY = 0.02 * env
      r.mano = env > 0.05 ? Math.sin(x * Math.PI * 6) * env : null
      break
    case 'salto': {
      // Se agacha, salta y aterriza aplastándose un poco.
      if (x < 0.2) {
        const q = x / 0.2
        r.escalaY = 1 - 0.12 * campana(q)
        r.escalaX = 1 + 0.06 * campana(q)
      } else if (x < 0.8) {
        const q = (x - 0.2) / 0.6
        r.posY = 0.13 * Math.sin(Math.PI * q)
        r.escalaY = 1 + 0.06 * Math.sin(Math.PI * q)
        r.escalaX = 1 - 0.03 * Math.sin(Math.PI * q)
      } else {
        const q = (x - 0.8) / 0.2
        r.escalaY = 1 - 0.1 * campana(q)
        r.escalaX = 1 + 0.05 * campana(q)
      }
      break
    }
    case 'asentir':
      r.rotX = 0.22 * Math.sin(x * Math.PI * 4) * env
      break
    case 'negar':
      r.rotY = 0.35 * Math.sin(x * Math.PI * 4) * env
      break
    case 'giro':
      r.rotY = Math.PI * 2 * suave(x)
      r.posY = 0.06 * env
      break
    case 'baile':
      r.rotZ = 0.16 * Math.sin(x * Math.PI * 6) * env
      r.posX = 0.05 * Math.sin(x * Math.PI * 6) * env
      r.posY = 0.04 * Math.abs(Math.sin(x * Math.PI * 12)) * env
      r.rotY = 0.25 * Math.sin(x * Math.PI * 3) * env
      break
    case 'estirarse':
      r.escalaY = 1 + 0.14 * env
      r.escalaX = 1 - 0.06 * env
      r.rotX = -0.12 * env
      break
    case 'mirar-alrededor':
      r.rotY = 0.55 * Math.sin(x * Math.PI * 2) * env
      r.rotX = -0.08 * env
      break
    case 'sacudida':
      r.rotZ = 0.12 * Math.sin(x * Math.PI * 10) * (1 - x)
      r.escalaX = 1 + 0.04 * Math.sin(x * Math.PI * 10) * (1 - x)
      break
    case 'reverencia':
      r.rotX = 0.45 * env
      r.posY = -0.03 * env
      break
  }
  return r
}

/** El gesto que acompaña a una cara al terminar de responder o al llegar un aviso (o null si no hace falta). */
export function gestoDeExpresion(id: IdExpresion): IdGesto | null {
  switch (id) {
    case 'orgulloso':
      return 'reverencia'
    case 'emocionado':
    case 'risa':
      return 'baile'
    case 'feliz':
      return 'asentir'
    case 'preocupado':
    case 'triste':
      return 'negar'
    case 'sorprendido':
      return 'salto'
    case 'curioso':
      return 'mirar-alrededor'
    default:
      return null
  }
}
