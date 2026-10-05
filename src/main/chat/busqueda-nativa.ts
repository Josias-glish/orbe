import Anthropic from '@anthropic-ai/sdk'
import type { AccionVista, FuenteVista } from '../../shared/tipos'
import { normalizarFuentes, type FuenteBruta } from '../agente/fuentes'
import { NOMBRE_BUSCAR_WEB } from '../agente/sesion'
import { recortar } from '../agente/validacion'
import type { ManejadoresTurno } from './proveedor'

/**
 * La búsqueda web de la API de Claude: la ejecutan los servidores de Anthropic y los resultados vuelven cifrados dentro
 * de la propia respuesta. Se usa la versión básica (`20250305`): las nuevas ejecutan código para filtrar resultados, y
 * aquí no hace falta.
 */
export const TIPO_BUSQUEDA_NATIVA = 'web_search_20250305'

export function definicionBusquedaNativa(maxUsos: number): Anthropic.Beta.BetaWebSearchTool20250305 {
  return { type: TIPO_BUSQUEDA_NATIVA, name: 'web_search', max_uses: maxUsos }
}

const TEXTO_ERROR_BUSQUEDA: Record<string, string> = {
  invalid_tool_input: 'La consulta no era válida.',
  unavailable: 'El servicio de búsqueda no está disponible ahora mismo.',
  max_uses_exceeded: 'Se alcanzó el máximo de búsquedas de esta petición.',
  too_many_requests: 'Demasiadas búsquedas seguidas.',
  query_too_long: 'La consulta era demasiado larga.',
  request_too_large: 'La petición era demasiado grande.'
}

const MAX_TITULO_ACCION = 120
const MAX_VISTA = 300

/** Un bloque cualquiera de la respuesta de la API, visto sin tipos: aquí solo se leen campos sueltos. */
type BloqueSuelto = Record<string, unknown>

const esObjeto = (v: unknown): v is BloqueSuelto => typeof v === 'object' && v !== null

/**
 * Cuenta en el chat cada búsqueda que hace Claude por su cuenta («Buscando: …» y luego cuántos resultados dio). La
 * consulta y el resultado llegan en dos bloques distintos de la respuesta, con la misma marca.
 */
export class SeguimientoBusquedas {
  private readonly consultas = new Map<string, { titulo: string; parametros: string }>()

  constructor(private readonly m: ManejadoresTurno) {}

  /** Recibe cada bloque de la respuesta en cuanto se completa. */
  alBloque(bloque: unknown): void {
    if (!esObjeto(bloque)) return
    if (bloque['type'] === 'server_tool_use' && bloque['name'] === 'web_search' && typeof bloque['id'] === 'string') {
      const entrada = esObjeto(bloque['input']) ? bloque['input'] : {}
      const consulta = typeof entrada['query'] === 'string' ? entrada['query'].trim() : ''
      const previa = {
        titulo: `Buscando: ${recortar(consulta || '…', MAX_TITULO_ACCION)}`,
        parametros: recortar(JSON.stringify({ consulta }), MAX_VISTA)
      }
      this.consultas.set(bloque['id'], previa)
      this.m.alAccion?.({ accionId: `busqueda-${bloque['id']}`, herramienta: NOMBRE_BUSCAR_WEB, estado: 'en_curso', ...previa })
      return
    }
    if (bloque['type'] === 'web_search_tool_result' && typeof bloque['tool_use_id'] === 'string') {
      const id = bloque['tool_use_id']
      const previa = this.consultas.get(id) ?? { titulo: 'Buscando en internet', parametros: '{}' }
      const contenido = bloque['content']
      let accion: Pick<AccionVista, 'estado' | 'resultado'>
      if (Array.isArray(contenido)) {
        const titulos = contenido.flatMap((r) => (esObjeto(r) && typeof r['title'] === 'string' ? [r['title']] : []))
        const cuantos = contenido.length === 1 ? '1 resultado' : `${contenido.length} resultados`
        accion = { estado: 'ok', resultado: recortar(titulos.length > 0 ? `${cuantos}: ${titulos.slice(0, 3).join(' · ')}` : cuantos, MAX_VISTA) }
      } else {
        const codigo = esObjeto(contenido) && typeof contenido['error_code'] === 'string' ? contenido['error_code'] : ''
        accion = { estado: 'error', resultado: TEXTO_ERROR_BUSQUEDA[codigo] ?? 'La búsqueda falló.' }
      }
      this.m.alAccion?.({ accionId: `busqueda-${id}`, herramienta: NOMBRE_BUSCAR_WEB, ...previa, ...accion })
    }
  }
}

/**
 * Los enlaces que se enseñan bajo la respuesta: los que Claude citó en el texto o, si no citó ninguno, los resultados
 * de sus búsquedas.
 */
export function fuentesDeContenido(contenido: readonly unknown[]): FuenteVista[] {
  const citadas: FuenteBruta[] = []
  const resultados: FuenteBruta[] = []
  for (const bloque of contenido) {
    if (!esObjeto(bloque)) continue
    if (bloque['type'] === 'text' && Array.isArray(bloque['citations'])) {
      for (const c of bloque['citations']) {
        if (esObjeto(c) && c['type'] === 'web_search_result_location') citadas.push({ titulo: c['title'], url: c['url'] })
      }
    } else if (bloque['type'] === 'web_search_tool_result' && Array.isArray(bloque['content'])) {
      for (const r of bloque['content']) {
        if (esObjeto(r) && r['type'] === 'web_search_result') resultados.push({ titulo: r['title'], url: r['url'] })
      }
    }
  }
  return normalizarFuentes(citadas.length > 0 ? citadas : resultados)
}

/**
 * Una respuesta cortada por su longitud puede acabar en mitad de una herramienta: el historial no puede conservar una
 * petición (nuestra o de búsqueda) sin su resultado, porque la API la rechaza.
 */
export function quitarBloquesIncompletos<T extends { type: string }>(contenido: readonly T[]): T[] {
  const conResultado = new Set(
    contenido.flatMap((b) => (b.type === 'web_search_tool_result' ? [String((b as unknown as BloqueSuelto)['tool_use_id'])] : []))
  )
  return contenido.filter((b) => {
    if (b.type === 'tool_use') return false
    if (b.type === 'server_tool_use') return conResultado.has(String((b as unknown as BloqueSuelto)['id']))
    return true
  })
}

/** La API rechazó la petición porque la búsqueda web no está activada en la organización (la puede apagar un administrador). */
export function esBusquedaNoDisponible(e: unknown): boolean {
  return e instanceof Anthropic.BadRequestError && /web[_ ]?search/i.test(e.message)
}

/**
 * Cuenta, para la línea del chat, el resultado de la búsqueda web que trae el CLI de Claude: su texto lleva una línea
 * «Links: [{"title":…,"url":…},…]». Si el formato cambia, se dice solo que terminó.
 */
export function describirResultadoBusquedaCli(texto: string): string {
  const linea = /^Links:\s*(\[.*\])\s*$/m.exec(texto)
  if (linea) {
    try {
      const lista = JSON.parse(linea[1]) as unknown
      if (Array.isArray(lista)) {
        const titulos = lista.flatMap((r) => (esObjeto(r) && typeof r['title'] === 'string' ? [r['title']] : []))
        const cuantos = lista.length === 1 ? '1 resultado' : `${lista.length} resultados`
        return recortar(titulos.length > 0 ? `${cuantos}: ${titulos.slice(0, 3).join(' · ')}` : cuantos, MAX_VISTA)
      }
    } catch {
      // Se cae al texto genérico.
    }
  }
  return 'Búsqueda terminada'
}
