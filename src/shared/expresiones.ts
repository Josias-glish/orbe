import type { EstadoOrbe } from './tipos'

/**
 * Las 20 expresiones del personaje. El orden importa: es el número que recibe un personaje de Rive en su entrada
 * `expresion` (0 = neutral … 19 = orgulloso), así que solo se añaden al final.
 */
export const IDS_EXPRESION = [
  'neutral',
  'feliz',
  'risa',
  'timido',
  'guino',
  'enamorado',
  'emocionado',
  'sorprendido',
  'curioso',
  'pensativo',
  'concentrado',
  'confundido',
  'triste',
  'llorando',
  'enfadado',
  'preocupado',
  'dormido',
  'aburrido',
  'travieso',
  'orgulloso'
] as const

export type IdExpresion = (typeof IDS_EXPRESION)[number]

/** Forma de los ojos: las formas especiales cambian el dibujo, no solo la apertura. */
export type FormaOjos = 'normal' | 'feliz' | 'cerrados' | 'corazon' | 'estrella' | 'espiral'
/** Forma de la boca: la curva y la apertura se interpolan; la forma cambia el trazo. */
export type FormaBoca = 'normal' | 'o' | 'lengua' | 'ondulada' | 'plana'
/** Adornos alrededor de la cara. */
export type Adorno = 'ninguno' | 'corazones' | 'brillos' | 'sudor' | 'lagrimas' | 'zzz' | 'interrogacion' | 'exclamacion' | 'enfado' | 'idea'

/** Todo lo que define una cara. Los números se interpolan suavemente; las formas cambian con un parpadeo. */
export interface Expresion {
  nombre: string
  emoji: string
  ojos: FormaOjos
  /** 0 = cerrados, 1 = normales, 1.25 = muy abiertos. */
  apertura: number
  /** Tamaño de la pupila (1 = normal). */
  pupila: number
  /** Guiña el ojo izquierdo (del personaje). */
  guino: boolean
  /** Inclinación de las cejas en grados: positivo = interior arriba (pena, duda), negativo = interior abajo (enfado). */
  cejas: number
  /** Altura de las cejas (px sobre su sitio); negativo las baja. */
  alturaCejas: number
  /** Levanta solo una ceja (curiosidad, duda). */
  cejaAsimetrica: number
  boca: FormaBoca
  /** -1 = triste, 0 = recta, 1 = sonrisa amplia. */
  curva: number
  /** 0 = cerrada, 1 = muy abierta. */
  aperturaBoca: number
  /** 0.6 = pequeña, 1 = normal, 1.4 = ancha. */
  anchoBoca: number
  /** Rubor de las mejillas, 0–1. */
  rubor: number
  adorno: Adorno
  /** Cuánto bota el cuerpo (0 = quieto). */
  bote: number
  /** Inclinación del cuerpo en grados. */
  inclinacion: number
  /** Hacia dónde miran los ojos por defecto (-1…1), si no siguen al cursor. */
  mirada?: { x: number; y: number }
}

const base: Omit<Expresion, 'nombre' | 'emoji'> = {
  ojos: 'normal',
  apertura: 1,
  pupila: 1,
  guino: false,
  cejas: 0,
  alturaCejas: 0,
  cejaAsimetrica: 0,
  boca: 'normal',
  curva: 0.25,
  aperturaBoca: 0,
  anchoBoca: 1,
  rubor: 0,
  adorno: 'ninguno',
  bote: 0,
  inclinacion: 0
}

const e = (nombre: string, emoji: string, cambios: Partial<Expresion>): Expresion => ({ ...base, nombre, emoji, ...cambios })

export const EXPRESIONES: Record<IdExpresion, Expresion> = {
  neutral: e('Neutral', '🙂', {}),
  feliz: e('Feliz', '😊', { curva: 0.85, anchoBoca: 1.1, rubor: 0.35, alturaCejas: 1.5, bote: 0.25 }),
  risa: e('Risa', '😄', { ojos: 'feliz', curva: 1, aperturaBoca: 0.75, anchoBoca: 1.25, rubor: 0.5, alturaCejas: 2.5, bote: 0.9 }),
  timido: e('Tímido', '☺️', { ojos: 'feliz', curva: 0.5, anchoBoca: 0.7, rubor: 1, cejas: 8, inclinacion: -7, mirada: { x: -0.5, y: 0.4 } }),
  guino: e('Guiño', '😉', { guino: true, curva: 0.9, anchoBoca: 1.05, rubor: 0.3, cejaAsimetrica: 3, inclinacion: 5 }),
  enamorado: e('Enamorado', '😍', { ojos: 'corazon', curva: 0.9, aperturaBoca: 0.2, rubor: 0.9, adorno: 'corazones', bote: 0.35 }),
  emocionado: e('Emocionado', '🤩', { ojos: 'estrella', curva: 1, aperturaBoca: 0.6, anchoBoca: 1.2, alturaCejas: 3, adorno: 'brillos', bote: 1 }),
  sorprendido: e('Sorprendido', '😮', { apertura: 1.25, pupila: 0.75, boca: 'o', aperturaBoca: 0.7, anchoBoca: 0.65, alturaCejas: 5, adorno: 'exclamacion' }),
  curioso: e('Curioso', '🧐', { apertura: 1.08, cejaAsimetrica: 5, curva: 0.1, anchoBoca: 0.8, inclinacion: 9, mirada: { x: 0.4, y: -0.1 } }),
  pensativo: e('Pensativo', '🤔', { apertura: 0.85, cejas: 6, cejaAsimetrica: 3, boca: 'plana', curva: -0.1, anchoBoca: 0.7, inclinacion: -6, adorno: 'idea', mirada: { x: 0.6, y: -0.7 } }),
  concentrado: e('Concentrado', '😤', { apertura: 0.72, cejas: -6, alturaCejas: -1.5, boca: 'plana', curva: 0, anchoBoca: 0.8, mirada: { x: 0, y: 0.25 } }),
  confundido: e('Confundido', '😵‍💫', { ojos: 'espiral', cejas: 10, cejaAsimetrica: 4, boca: 'ondulada', anchoBoca: 0.9, adorno: 'interrogacion', inclinacion: 10 }),
  triste: e('Triste', '😢', { apertura: 0.85, cejas: 14, alturaCejas: 1, curva: -0.75, anchoBoca: 0.8, mirada: { x: 0, y: 0.6 } }),
  llorando: e('Llorando', '😭', { ojos: 'cerrados', cejas: 18, alturaCejas: 2, curva: -1, aperturaBoca: 0.55, anchoBoca: 1, adorno: 'lagrimas', bote: 0.4 }),
  enfadado: e('Enfadado', '😠', { apertura: 0.8, pupila: 0.9, cejas: -18, alturaCejas: -2.5, curva: -0.55, anchoBoca: 0.9, rubor: 0.15, adorno: 'enfado' }),
  preocupado: e('Preocupado', '😟', { apertura: 1.05, cejas: 15, alturaCejas: 2, boca: 'ondulada', curva: -0.3, anchoBoca: 0.85, adorno: 'sudor' }),
  dormido: e('Dormido', '😴', { ojos: 'cerrados', apertura: 0, curva: 0.1, boca: 'o', aperturaBoca: 0.25, anchoBoca: 0.5, adorno: 'zzz', inclinacion: -8 }),
  aburrido: e('Aburrido', '😑', { apertura: 0.45, cejas: 3, alturaCejas: -1, boca: 'plana', curva: -0.1, anchoBoca: 0.9, mirada: { x: -0.6, y: 0.2 } }),
  travieso: e('Travieso', '😜', { guino: true, boca: 'lengua', curva: 0.8, aperturaBoca: 0.45, anchoBoca: 1.1, cejaAsimetrica: 4, rubor: 0.3, inclinacion: -9, bote: 0.5 }),
  orgulloso: e('Orgulloso', '😌', { ojos: 'feliz', curva: 0.7, anchoBoca: 0.95, alturaCejas: 2, rubor: 0.25, inclinacion: 4, mirada: { x: 0, y: -0.4 } })
}

/** La expresión de fondo de cada estado de la conversación. */
export const EXPRESION_DE_ESTADO: Record<EstadoOrbe, IdExpresion> = {
  reposo: 'neutral',
  leyendo: 'curioso',
  pensando: 'pensativo',
  respondiendo: 'feliz',
  escuchando: 'curioso',
  actuando: 'concentrado'
}

export function esIdExpresion(v: unknown): v is IdExpresion {
  return typeof v === 'string' && (IDS_EXPRESION as readonly string[]).includes(v)
}

/** Número de la expresión para la entrada `expresion` de un personaje de Rive. */
export function indiceExpresion(id: IdExpresion): number {
  return IDS_EXPRESION.indexOf(id)
}

/** Las partes numéricas de una expresión, que se interpolan entre una cara y otra. */
export const CAMPOS_NUMERICOS = [
  'apertura',
  'pupila',
  'cejas',
  'alturaCejas',
  'cejaAsimetrica',
  'curva',
  'aperturaBoca',
  'anchoBoca',
  'rubor',
  'bote',
  'inclinacion'
] as const satisfies readonly (keyof Expresion)[]

export type CaraNumerica = Record<(typeof CAMPOS_NUMERICOS)[number], number>

export function caraNumerica(ex: Expresion): CaraNumerica {
  const r = {} as CaraNumerica
  for (const c of CAMPOS_NUMERICOS) r[c] = ex[c] as number
  return r
}
