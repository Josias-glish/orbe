import type { AlmacenMemoria } from '../memoria/almacen'
import { tituloDe, type AlmacenConversacion } from '../memoria/conversacion'
import { leerJson, type DocIndice } from './base'

export interface FuentesIndice {
  conversaciones: AlmacenConversacion
  memoria: AlmacenMemoria
  /** metricas.json (historial diario por cuenta) y contenido.json (ideas y publicaciones), si existen. */
  rutaMetricas?: string
  rutaContenido?: string
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Todo lo que se puede buscar, leído de sus archivos: conversaciones, recuerdos, métricas y contenido. */
export function documentosIndice(f: FuentesIndice): DocIndice[] {
  const docs: DocIndice[] = []
  for (const c of f.conversaciones.todas()) {
    docs.push({
      tipo: 'conversacion',
      ref: c.id,
      titulo: tituloDe(c.mensajes),
      texto: c.mensajes.map((m) => `${m.rol === 'usuario' ? 'Usuario' : 'Orbe'}: ${m.texto}`).join('\n'),
      fecha: c.actualizada
    })
  }
  for (const r of f.memoria.listar()) {
    docs.push({ tipo: 'recuerdo', ref: r.id, titulo: r.descripcion, texto: r.cuerpo, fecha: r.modificado })
  }
  const metricas = f.rutaMetricas ? leerJson(f.rutaMetricas) : null
  const historial = (metricas as { historial?: Record<string, unknown> } | null)?.historial
  if (historial && typeof historial === 'object') {
    for (const [cuenta, dias] of Object.entries(historial)) {
      if (!Array.isArray(dias)) continue
      const lineas = dias.map((d: Record<string, unknown>) => `${texto(d['fecha'])}: ${d['seguidores'] ?? '?'} seguidores, alcance medio ${d['alcanceMedio'] ?? '?'}`)
      docs.push({ tipo: 'metricas', ref: cuenta, titulo: `Métricas de ${cuenta}`, texto: lineas.join('\n'), fecha: texto(dias.at(-1)?.['fecha']) })
    }
  }
  const contenido = f.rutaContenido ? leerJson(f.rutaContenido) : null
  if (Array.isArray(contenido)) {
    for (const c of contenido as Array<Record<string, unknown>>) {
      const cuerpo = [texto(c['idea']), texto(c['texto']), texto(c['pie'])].filter(Boolean).join('\n\n')
      if (!cuerpo) continue
      docs.push({
        tipo: 'contenido',
        ref: texto(c['id']) || String(docs.length),
        titulo: `${texto(c['marca']) || 'Contenido'}: ${texto(c['texto']).split('\n')[0]?.slice(0, 80) || texto(c['idea']).slice(0, 80)}`,
        texto: cuerpo,
        fecha: texto(c['fecha']) || texto(c['creado'])
      })
    }
  }
  return docs
}
