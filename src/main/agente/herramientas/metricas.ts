import { CUENTAS, NOMBRE_CUENTA, type Cuenta } from '../../conectores/instagram/cliente'
import type { ServicioMetricas } from '../../metricas/servicio'
import { definirHerramienta, type Herramienta } from '../tipos'
import { crearEsquema, crearValidador, type Campos } from '../validacion'

const campos = { cuenta: { tipo: 'opcion', descripcion: 'Cuenta: morfy o personal (su marca personal).', valores: CUENTAS } } as const satisfies Campos

/**
 * `ig_crecimiento`: la evolución guardada en el equipo (seguidores por día y alcance medio) más la comparación de cada
 * publicación reciente con la media de la cuenta. Es lo que necesita un análisis de crecimiento; solo lee.
 */
export function crearHerramientaCrecimiento(servicio: ServicioMetricas): Herramienta {
  return definirHerramienta<{ cuenta: Cuenta }>({
    nombre: 'ig_crecimiento',
    descripcion:
      'Evolución de una cuenta de Instagram del usuario: seguidores por día (historial guardado por Orbe), crecimiento a 7 y 30 días, ' +
      'medias de alcance, interacciones y tasa de interacción, y cada publicación reciente comparada con esas medias. Úsala para analizar el crecimiento.',
    esquema: crearEsquema(campos),
    nivel: 'libre',
    accion: 'ig.leer',
    validar: crearValidador<{ cuenta: Cuenta }>(campos),
    describir: (e) => `Mirando la evolución de ${NOMBRE_CUENTA[e.cuenta]}`,
    async ejecutar(e, ctx) {
      const i = await servicio.leer(e.cuenta, ctx.senal)
      const pct = (v: number | undefined, m: number | null): string => (v === undefined || !m ? '—' : `${v >= m ? '+' : ''}${Math.round(((v - m) / m) * 100)} %`)
      const lineas = [
        `Cuenta: @${i.usuario} · ${i.seguidores} seguidores · ${i.numPublicaciones} publicaciones`,
        `Crecimiento: 7 días ${i.crecimiento.dias7 ?? 'sin datos'} · 30 días ${i.crecimiento.dias30 ?? 'sin datos'}`,
        `Medias (últimas ${i.publicaciones.length}): alcance ${i.medias.alcance ?? '—'} · interacciones ${i.medias.interacciones ?? '—'} · tasa ${i.medias.tasa ?? '—'} %`,
        ...(i.avisoMetricas ? [`Aviso: ${i.avisoMetricas}`] : []),
        `Historial de seguidores: ${i.historial.slice(-30).map((d) => `${d.fecha}=${d.seguidores}`).join(', ') || 'aún sin días guardados'}`,
        '',
        ...i.publicaciones.map(
          (p) =>
            `${p.fecha.slice(0, 16)} · ${p.tipo} · alcance ${p.alcance ?? '—'} (${pct(p.alcance, i.medias.alcance)}) · tasa ${p.tasa ?? '—'} % · ` +
            `guardados ${p.guardados ?? '—'} · compartidos ${p.compartidos ?? '—'} · ${p.enlace}\n  Pie: ${p.pie || '(sin pie)'}`
        )
      ]
      return { texto: lineas.join('\n'), externo: { origen: 'Instagram' } }
    }
  })
}
