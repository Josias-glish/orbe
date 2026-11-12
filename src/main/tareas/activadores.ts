import { readdirSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { uptime } from 'node:os'
import type { TareaVista } from '../../shared/tipos'

/** Lo que un activador ve: un id estable (para no avisar dos veces) y una línea para contárselo al agente. */
export interface Novedad {
  id: string
  linea: string
}

export interface FuentesActivadores {
  tareas: () => TareaVista[]
  /** Correos recientes de la bandeja (null si Gmail no está conectado). */
  correos?: () => Promise<Novedad[]> | null
  /** Comentarios recientes en las publicaciones de esa cuenta (null si no hay token). */
  comentarios?: (cuenta: string) => Promise<Novedad[]> | null
  leerVistos: (tareaId: string) => string[] | null
  guardarVistos: (tareaId: string, ids: string[]) => void
  disparar: (tareaId: string, contexto: string) => void
}

const MAX_VISTOS = 300
/** Si el PC lleva encendido menos que esto cuando Orbe arranca, cuenta como «al encender el PC». */
export const ARRANQUE_MAX_S = 20 * 60

/** Archivos de una carpeta (no subcarpetas), con su fecha, para notar los nuevos. */
function archivosDe(carpeta: string): Novedad[] {
  if (!isAbsolute(carpeta)) return []
  return readdirSync(carpeta, { withFileTypes: true })
    .filter((e) => e.isFile())
    .slice(0, 2000)
    .map((e) => {
      const ruta = join(carpeta, e.name)
      return { id: `${e.name}|${statSync(ruta).mtimeMs}`, linea: `- ${e.name}` }
    })
}

/**
 * Los activadores por sondeo (P3): cada tarea «cuando pase algo» mira su fuente y, si hay algo que no había visto, se
 * lanza con eso como contexto. La primera vez solo toma nota de lo que hay (no avisa de lo antiguo).
 * `arranque` es la primera vuelta después de abrir Orbe.
 */
export async function revisarActivadores(f: FuentesActivadores, arranque: boolean, segundosEncendido = uptime()): Promise<void> {
  for (const t of f.tareas()) {
    if (!t.activa || t.programa.tipo !== 'evento') continue
    const p = t.programa
    try {
      if (p.evento === 'encender') {
        if (arranque && segundosEncendido < ARRANQUE_MAX_S) f.disparar(t.id, 'Se acaba de encender el PC.')
        continue
      }
      const pendiente =
        p.evento === 'correo' ? f.correos?.() : p.evento === 'instagram' ? f.comentarios?.(p.cuenta ?? 'morfy') : Promise.resolve(archivosDe(p.carpeta ?? ''))
      if (!pendiente) continue
      const actuales = await pendiente
      const vistos = f.leerVistos(t.id)
      const nuevos = vistos ? actuales.filter((n) => !vistos.includes(n.id)) : []
      f.guardarVistos(t.id, [...new Set([...actuales.map((n) => n.id), ...(vistos ?? [])])].slice(0, MAX_VISTOS))
      if (nuevos.length === 0) continue
      const que = p.evento === 'correo' ? 'Correos nuevos' : p.evento === 'instagram' ? 'Comentarios nuevos' : `Archivos nuevos en ${p.carpeta}`
      f.disparar(t.id, `${que}:\n${nuevos.slice(0, 15).map((n) => n.linea).join('\n')}`)
    } catch (e) {
      console.warn(`[orbe] El activador de «${t.titulo}» falló:`, e instanceof Error ? e.message : e)
    }
  }
}
