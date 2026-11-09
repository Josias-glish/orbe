/* Formato de textos y fechas de la vista de tareas (sin DOM: se puede probar). */

/** «hoy 08:30», «mañana 09:00», «lun 12/11 18:00». */
export function cuandoCorto(ms: number, ahora = Date.now()): string {
  const d = new Date(ms)
  const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  const dia = (x: Date): string => x.toDateString()
  const hoy = new Date(ahora)
  const manana = new Date(ahora + 86_400_000)
  const ayer = new Date(ahora - 86_400_000)
  if (dia(d) === dia(hoy)) return `hoy ${hora}`
  if (dia(d) === dia(manana)) return `mañana ${hora}`
  if (dia(d) === dia(ayer)) return `ayer ${hora}`
  return `${d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'numeric' })} ${hora}`
}

/** Duración legible: «12 s», «3 min», «1 h 5 min». */
export function duracion(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`
}

/**
 * El resultado en texto corrido para la vista previa de la tarjeta: sin la sintaxis de Markdown (asteriscos,
 * almohadillas, viñetas) y con los enlaces reducidos a su texto, para que no salgan direcciones largas.
 */
export function textoPlano(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/[^\s)\]]+/g, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|`|~~)/g, '')
    .replace(/[ \t]*\n+[ \t]*/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^( · )+|( · )+$/g, '')
    .trim()
}
