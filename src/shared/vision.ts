/** Lo que los «ojos» del Compañero ven en una ventana: perfil «pantalla» (COMPANERO-Y-CONFIGURACION.md C.1, literal). */
export interface DescripcionPantalla {
  sensible: boolean
  actividad: 'viendo_video' | 'disenando' | 'programando' | 'leyendo' | 'escribiendo' | 'jugando' | 'navegando' | 'otra'
  app: string
  que_se_ve: string
  titulo_obra: string
  textos_visibles: string[]
}

const ACTIVIDADES = ['viendo_video', 'disenando', 'programando', 'leyendo', 'escribiendo', 'jugando', 'navegando', 'otra']

/**
 * Valida la respuesta del modelo (un JSON, a veces dentro de ```json). Si no cumple el esquema se descarta (null).
 * Lo «sensible» se devuelve vacío: no se conserva nada de lo que se vio.
 */
export function validarPantalla(respuesta: string): DescripcionPantalla | null {
  const json = /\{[\s\S]*\}/.exec(respuesta)?.[0]
  if (!json) return null
  let d: Record<string, unknown>
  try {
    d = JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof d !== 'object' || d === null) return null
  if (d['sensible'] === true) return { sensible: true, actividad: 'otra', app: '', que_se_ve: '', titulo_obra: '', textos_visibles: [] }
  const t = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null)
  const textos = d['textos_visibles']
  if (
    d['sensible'] !== false ||
    typeof d['actividad'] !== 'string' ||
    !ACTIVIDADES.includes(d['actividad']) ||
    t(d['app'], 80) === null ||
    t(d['que_se_ve'], 600) === null ||
    t(d['titulo_obra'], 200) === null ||
    !Array.isArray(textos) ||
    textos.length > 5 ||
    !textos.every((x) => typeof x === 'string' && x.length <= 120)
  ) {
    return null
  }
  return d as unknown as DescripcionPantalla
}

/** El estado de la visión para la interfaz: nunca la clave, solo si hace falta y falta. */
export interface EstadoVision {
  proveedor: string
  modelo: string
  /** Lista para usarse (proveedor elegido, clave si hace falta y consentimiento). */
  activa: boolean
  consentida: boolean
  /** Por qué no funciona (apagada, falta la clave…), si es el caso. */
  motivo?: string
  usadasHoy: number
  maxDia: number
}

export type ResultadoOjos =
  | { ok: true; descripcion: DescripcionPantalla; ventana: string; estado: EstadoVision }
  | { ok: false; error: string; estado: EstadoVision }
