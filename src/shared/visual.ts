/**
 * ¿La pregunta parece ser sobre cómo se ve algo (una imagen, un gráfico, un diseño)? Sirve solo para
 * sugerir una captura de pantalla, nunca para hacerla: por eso prefiere pecar de generosa.
 */
const PALABRAS = [
  'imagen',
  'imágenes',
  'foto',
  'fotos',
  'fotografía',
  'captura',
  'capturas',
  'pantallazo',
  'screenshot',
  'gráfico',
  'gráfica',
  'gráficos',
  'gráficas',
  'diagrama',
  'dibujo',
  'ilustración',
  'color',
  'colores',
  'aspecto',
  'diseño',
  'interfaz',
  'maqueta',
  'logo',
  'logotipo',
  'icono',
  'botón',
  'botones',
  'tipografía',
  'layout'
]

const FRASES = [
  'se\\s+ve',
  'se\\s+ven',
  'c[oó]mo\\s+(?:queda|luce|se\\s+ve)',
  '(?:la|mi|esta)\\s+pantalla',
  'en\\s+pantalla',
  'lo\\s+que\\s+(?:ves|veo)',
  'mira\\s+(?:esto|esta|este|lo)'
]

const PATRON = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...PALABRAS, ...FRASES].join('|')})(?![\\p{L}\\p{N}])`, 'iu')

export function esPreguntaVisual(texto: string): boolean {
  return PATRON.test(texto)
}
