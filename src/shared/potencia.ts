import type { InfoPotencia, NivelEsfuerzo } from './tipos'

/** Los textos del marcador de potencia (compartidos para poder probarlos sin la interfaz). */
export const NOMBRE_NIVEL: Record<NivelEsfuerzo, string> = {
  low: 'Rápido',
  medium: 'Equilibrado',
  high: 'Potente',
  xhigh: 'Muy potente',
  max: 'Máximo'
}

export const DESCRIPCION_NIVEL: Record<NivelEsfuerzo, string> = {
  low: 'Responde enseguida y gasta poco. Va bien para preguntas sencillas.',
  medium: 'El punto de partida: buena calidad sin esperar demasiado.',
  high: 'Piensa más a fondo. Tarda algo más y gasta más.',
  xhigh: 'Para tareas difíciles: código, análisis largos o varios pasos.',
  max: 'Lo más que puede pensar. Es lo más lento y lo que más gasta.'
}

export const CUANDO_APLICA: Record<InfoPotencia['aplica'], string> = {
  ahora: 'Se aplica desde tu próximo mensaje.',
  proxima_conversacion: 'Con el CLI de Claude se aplica desde la próxima conversación (pulsa el lápiz para empezar una).',
  segun_servicio: 'Solo lo notan los modelos con niveles de razonamiento; si tu servicio no lo admite, Orbe lo ignora.'
}
