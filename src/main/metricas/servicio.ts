import { readFileSync, writeFileSync } from 'node:fs'
import type { Cuenta, Instagram } from '../conectores/instagram/cliente'
import type { DiaMetricas, InformeMetricas, PublicacionMetricas } from '../../shared/tipos'

const PUBLICACIONES = 12
const DIAS_HISTORIAL = 365

/** Interacciones de una publicación: el total de Meta o, si no lo da, la suma de sus partes. */
function interacciones(p: Pick<PublicacionMetricas, 'meGusta' | 'comentarios' | 'compartidos' | 'guardados' | 'interacciones'>): number {
  return p.interacciones ?? p.meGusta + p.comentarios + (p.compartidos ?? 0) + (p.guardados ?? 0)
}

/** Tasa de interacción sobre el alcance (en %); sin alcance, sobre los seguidores. `null` si no hay base. */
export function tasaInteraccion(p: Parameters<typeof interacciones>[0] & { alcance?: number }, seguidores: number): number | null {
  const base = p.alcance || seguidores
  return base > 0 ? Math.round((interacciones(p) / base) * 1000) / 10 : null
}

const media = (xs: number[]): number | null => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

/** El día local en formato AAAA-MM-DD. */
export function dia(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
}

/**
 * Las métricas de cada cuenta para la pestaña «Métricas»: perfil, últimas publicaciones con sus cifras y su
 * comparación con la media, y un historial diario (seguidores y alcance medio) en `metricas.json`, porque Instagram
 * solo da datos recientes. Solo lee: nunca publica ni responde.
 */
export class ServicioMetricas {
  private historial: Partial<Record<Cuenta, DiaMetricas[]>> = {}
  private ultimos: Partial<Record<Cuenta, InformeMetricas>> = {}

  constructor(
    private readonly archivo: string | null,
    private readonly ig: (cuenta: Cuenta) => Pick<Instagram, 'perfil' | 'publicaciones' | 'metricas'>,
    private readonly ahora: () => Date = () => new Date()
  ) {
    if (!archivo) return
    try {
      const leido = JSON.parse(readFileSync(archivo, 'utf8')) as { historial?: ServicioMetricas['historial'] }
      this.historial = leido.historial ?? {}
    } catch {
      // Sin archivo se empieza vacío.
    }
  }

  /** El último informe leído de la cuenta (sin llamar a Instagram), con el historial al día. */
  guardado(cuenta: Cuenta): InformeMetricas | null {
    const u = this.ultimos[cuenta]
    return u ? { ...u, historial: this.historial[cuenta] ?? [], crecimiento: this.crecimiento(cuenta) } : null
  }

  private crecimiento(cuenta: Cuenta): InformeMetricas['crecimiento'] {
    const h = this.historial[cuenta] ?? []
    return { dias7: cambioDesde(h, 7, this.ahora()), dias30: cambioDesde(h, 30, this.ahora()) }
  }

  historialDe(cuenta: Cuenta): readonly DiaMetricas[] {
    return this.historial[cuenta] ?? []
  }

  async leer(cuenta: Cuenta, senal?: AbortSignal): Promise<InformeMetricas> {
    const cliente = this.ig(cuenta)
    const perfil = await cliente.perfil(senal)
    const pubs = await cliente.publicaciones(PUBLICACIONES, senal)
    let avisoMetricas: string | undefined
    const filas: PublicacionMetricas[] = await Promise.all(
      pubs.map(async (p) => {
        const fila: PublicacionMetricas = { id: p.id, tipo: p.tipo, fecha: p.fecha, enlace: p.enlace, pie: p.pie.slice(0, 160), meGusta: p.meGusta, comentarios: p.comentarios }
        try {
          const m = await cliente.metricas(p.id, senal)
          Object.assign(fila, {
            visualizaciones: m.views,
            alcance: m.reach,
            meGusta: m.likes ?? p.meGusta,
            comentarios: m.comments ?? p.comentarios,
            compartidos: m.shares,
            guardados: m.saved,
            interacciones: m.total_interactions
          })
        } catch (e) {
          if (senal?.aborted) throw e
          avisoMetricas ??= e instanceof Error ? e.message : String(e)
        }
        fila.tasa = tasaInteraccion(fila, perfil.seguidores) ?? undefined
        return fila
      })
    )
    const conAlcance = filas.filter((f) => f.alcance !== undefined)
    const medias = {
      alcance: media(conAlcance.map((f) => f.alcance as number)),
      interacciones: media(filas.map(interacciones)),
      tasa: filas.some((f) => f.tasa !== undefined) ? Math.round((filas.reduce((a, f) => a + (f.tasa ?? 0), 0) / filas.filter((f) => f.tasa !== undefined).length) * 10) / 10 : null
    }
    this.anotarDia(cuenta, { fecha: dia(this.ahora()), seguidores: perfil.seguidores, alcanceMedio: medias.alcance ?? undefined })
    const informe: InformeMetricas = {
      cuenta,
      leido: this.ahora().getTime(),
      usuario: perfil.usuario,
      seguidores: perfil.seguidores,
      numPublicaciones: perfil.publicaciones,
      publicaciones: filas,
      medias,
      historial: this.historial[cuenta] ?? [],
      crecimiento: this.crecimiento(cuenta),
      ...(avisoMetricas ? { avisoMetricas } : {})
    }
    this.ultimos[cuenta] = informe
    return informe
  }

  /** Un punto por día y cuenta (el último del día manda); se guardan como mucho los últimos 365. */
  private anotarDia(cuenta: Cuenta, punto: DiaMetricas): void {
    const lista = (this.historial[cuenta] ?? []).filter((d) => d.fecha !== punto.fecha)
    lista.push(punto)
    lista.sort((a, b) => a.fecha.localeCompare(b.fecha))
    this.historial[cuenta] = lista.slice(-DIAS_HISTORIAL)
    if (this.archivo) writeFileSync(this.archivo, JSON.stringify({ historial: this.historial }, null, 2))
  }
}

/** Cuánto cambió una cifra frente a hace `dias` días según el historial (el punto más cercano anterior). */
export function cambioDesde(historial: readonly DiaMetricas[], dias: number, hoy: Date): number | null {
  if (historial.length < 2) return null
  const limite = dia(new Date(hoy.getTime() - dias * 86_400_000))
  const antes = [...historial].reverse().find((d) => d.fecha <= limite) ?? historial[0]
  const ultimo = historial[historial.length - 1]
  return antes === ultimo ? null : ultimo.seguidores - antes.seguidores
}
