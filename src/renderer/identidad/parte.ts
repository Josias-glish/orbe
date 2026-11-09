import type { DatosParte } from '../../shared/identidad'
import type { EstadoTareas, ResumenUso } from '../../shared/tipos'

const mismoDia = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** «12,3 mil tokens · 0,04 $» (o vacío si hoy no se ha gastado nada). */
export function formatearConsumo(uso: ResumenUso['hoy'] | null): string {
  if (!uso || uso.peticiones === 0) return ''
  const tokens = uso.entrada + uso.salida + uso.cache
  const t =
    tokens >= 1_000_000
      ? `${(tokens / 1_000_000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} M tokens`
      : tokens >= 1000
        ? `${(tokens / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} mil tokens`
        : `${tokens} tokens`
  if (uso.costeUsd > 0) return `${t} · ${uso.costeUsd.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
  return uso.sinPrecio ? `${t} (sin precio conocido)` : t
}

/**
 * Reúne lo que cuenta el parte de situación a partir del estado de las tareas y del consumo: lo que queda por hacer
 * hoy, lo que terminó desde `desde` (ms) y lo que espera permiso.
 */
export function datosDelParte(estado: EstadoTareas | null, uso: ResumenUso | null, ahora: Date, desde: number): DatosParte {
  const tareas = estado?.tareas ?? []
  const programadasHoy = tareas
    .filter((t) => t.activa && t.proxima !== null && t.proxima >= ahora.getTime() && mismoDia(new Date(t.proxima), ahora))
    .map((t) => ({ titulo: t.titulo, cuando: t.proxima as number }))
  const terminadas: DatosParte['terminadas'] = []
  let permisos = 0
  for (const t of tareas) {
    for (const e of t.historial) {
      if (e.estado === 'esperando' && e.permiso) permisos++
      if (e.fin !== null && e.fin > desde && (e.estado === 'completada' || e.estado === 'error')) {
        terminadas.push({ titulo: t.titulo, ok: e.estado === 'completada' })
      }
    }
  }
  return { ahora, programadasHoy, terminadas, permisos, consumoHoy: formatearConsumo(uso?.hoy ?? null) }
}
