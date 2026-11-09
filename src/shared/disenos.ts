/** La silueta del cuerpo del personaje. */
export type FormaCuerpo = 'gota' | 'nube' | 'triangulo' | 'corazon' | 'estrella' | 'huevo' | 'fantasma' | 'cubo'

/** Lo que lleva puesto. */
export type Accesorio =
  | 'ninguno'
  | 'bufanda'
  | 'auriculares'
  | 'corona'
  | 'antena'
  | 'gorro'
  | 'aureola'
  | 'orejas-conejo'
  | 'orejas-gato'
  | 'hoja'
  | 'chistera'
  | 'lazo'
  | 'pajarita'
  | 'gafas'
  | 'flor'
  | 'cuernos'
  | 'gorra'

/** Un diseño del personaje: forma, colores y accesorio. Las 20 expresiones funcionan igual en todos. */
export interface Diseno {
  id: string
  nombre: string
  forma: FormaCuerpo
  /** Degradado del cuerpo: luz, medio, sombra, borde. */
  piel: [string, string, string, string]
  /** Color de ojos, cejas y boca (oscuro en cuerpos claros, claro en cuerpos oscuros). */
  rasgos: string
  /** Color del brillo que lo rodea en reposo. */
  halo: string
  accesorio: Accesorio
  /** Color principal del accesorio. */
  colorAccesorio: string
}

export const DISENOS: readonly Diseno[] = [
  { id: 'orbi', nombre: 'Orbi', forma: 'gota', piel: ['#c4f1ff', '#7dd3fc', '#8b5cf6', '#5b21b6'], rasgos: '#1b1440', halo: '#7c8cff', accesorio: 'ninguno', colorAccesorio: '#fff' },
  { id: 'nimbo', nombre: 'Nimbo', forma: 'nube', piel: ['#f0f9ff', '#bae6fd', '#60a5fa', '#2563eb'], rasgos: '#0f1d3d', halo: '#93c5fd', accesorio: 'bufanda', colorAccesorio: '#ef4444' },
  { id: 'pico', nombre: 'Pico', forma: 'triangulo', piel: ['#fef9c3', '#fde047', '#f59e0b', '#b45309'], rasgos: '#3b2106', halo: '#fcd34d', accesorio: 'auriculares', colorAccesorio: '#334155' },
  { id: 'reina', nombre: 'Reina', forma: 'corazon', piel: ['#ffe4f1', '#f9a8d4', '#ec4899', '#9d174d'], rasgos: '#3d0a24', halo: '#f472b6', accesorio: 'corona', colorAccesorio: '#facc15' },
  { id: 'chispa', nombre: 'Chispa', forma: 'estrella', piel: ['#fff7d6', '#fcd34d', '#f97316', '#c2410c'], rasgos: '#3a1604', halo: '#fdba74', accesorio: 'antena', colorAccesorio: '#f43f5e' },
  { id: 'copo', nombre: 'Copo', forma: 'huevo', piel: ['#fffbeb', '#fef3c7', '#fcd9a8', '#d6a46a'], rasgos: '#3a2a16', halo: '#fde68a', accesorio: 'gorro', colorAccesorio: '#2563eb' },
  { id: 'boo', nombre: 'Boo', forma: 'fantasma', piel: ['#faf5ff', '#e9d5ff', '#c084fc', '#7e22ce'], rasgos: '#2a0f45', halo: '#d8b4fe', accesorio: 'aureola', colorAccesorio: '#fde047' },
  { id: 'menta', nombre: 'Menta', forma: 'gota', piel: ['#ecfdf5', '#a7f3d0', '#34d399', '#047857'], rasgos: '#062b1f', halo: '#6ee7b7', accesorio: 'orejas-conejo', colorAccesorio: '#fbcfe8' },
  { id: 'mishi', nombre: 'Mishi', forma: 'gota', piel: ['#fff1e6', '#fdba74', '#f97316', '#c2410c'], rasgos: '#3a1604', halo: '#fb923c', accesorio: 'orejas-gato', colorAccesorio: '#fecaca' },
  { id: 'brote', nombre: 'Brote', forma: 'cubo', piel: ['#f0fdf4', '#bbf7d0', '#4ade80', '#15803d'], rasgos: '#052e16', halo: '#86efac', accesorio: 'hoja', colorAccesorio: '#16a34a' },
  { id: 'gala', nombre: 'Gala', forma: 'gota', piel: ['#ffe4e6', '#fda4af', '#fb7185', '#be123c'], rasgos: '#3f0715', halo: '#fda4af', accesorio: 'chistera', colorAccesorio: '#1f2937' },
  { id: 'algodon', nombre: 'Algodón', forma: 'nube', piel: ['#fff1f8', '#fbcfe8', '#f472b6', '#be185d'], rasgos: '#3d0a24', halo: '#f9a8d4', accesorio: 'lazo', colorAccesorio: '#8b5cf6' },
  { id: 'tico', nombre: 'Tico', forma: 'triangulo', piel: ['#ecfeff', '#a5f3fc', '#22d3ee', '#0e7490'], rasgos: '#06282f', halo: '#67e8f9', accesorio: 'pajarita', colorAccesorio: '#e11d48' },
  { id: 'noctis', nombre: 'Noctis', forma: 'gota', piel: ['#64748b', '#334155', '#1e1b4b', '#0f0a2e'], rasgos: '#e0f2fe', halo: '#818cf8', accesorio: 'gafas', colorAccesorio: '#e2e8f0' },
  { id: 'lila', nombre: 'Lila', forma: 'estrella', piel: ['#f5f3ff', '#ddd6fe', '#a78bfa', '#6d28d9'], rasgos: '#1e1145', halo: '#c4b5fd', accesorio: 'flor', colorAccesorio: '#fb7185' },
  { id: 'travi', nombre: 'Travi', forma: 'huevo', piel: ['#f7fee7', '#d9f99d', '#84cc16', '#4d7c0f'], rasgos: '#1a2e05', halo: '#bef264', accesorio: 'cuernos', colorAccesorio: '#dc2626' },
  { id: 'bit', nombre: 'Bit', forma: 'cubo', piel: ['#f1f5f9', '#cbd5e1', '#94a3b8', '#475569'], rasgos: '#0f172a', halo: '#7dd3fc', accesorio: 'antena', colorAccesorio: '#22d3ee' },
  { id: 'ritmo', nombre: 'Ritmo', forma: 'corazon', piel: ['#fee2e2', '#fca5a5', '#ef4444', '#991b1b'], rasgos: '#3a0606', halo: '#f87171', accesorio: 'auriculares', colorAccesorio: '#111827' },
  { id: 'neon', nombre: 'Neón', forma: 'gota', piel: ['#4c1d95', '#2e1065', '#170b3b', '#09051f'], rasgos: '#5eead4', halo: '#2dd4bf', accesorio: 'gorra', colorAccesorio: '#14b8a6' },
  { id: 'nieve', nombre: 'Nieve', forma: 'fantasma', piel: ['#ffffff', '#f1f5f9', '#cbd5e1', '#64748b'], rasgos: '#0f172a', halo: '#bae6fd', accesorio: 'bufanda', colorAccesorio: '#0ea5e9' }
]

export const DISENO_POR_DEFECTO = DISENOS[0]

export function disenoPorId(id: string | null | undefined): Diseno {
  return DISENOS.find((d) => d.id === id) ?? DISENO_POR_DEFECTO
}
