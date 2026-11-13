import type { ResultadoBusqueda, TipoDoc } from '../../datos/base'
import { definirHerramienta, type Herramienta } from '../tipos'
import { crearEsquema, crearValidador } from '../validacion'

const campos = {
  consulta: { tipo: 'texto', descripcion: 'Palabras a buscar (sin comillas ni operadores).', max: 200 },
  en: { tipo: 'opcion', descripcion: 'Limitar a un tipo (por defecto, todo).', valores: ['conversaciones', 'recuerdos', 'metricas', 'contenido', 'informes'], opcional: true }
} as const

const TIPO: Record<string, TipoDoc> = { conversaciones: 'conversacion', recuerdos: 'recuerdo', metricas: 'metricas', contenido: 'contenido', informes: 'informe' }
const NOMBRE: Record<TipoDoc, string> = { conversacion: 'Conversación', recuerdo: 'Recuerdo', metricas: 'Métricas', contenido: 'Contenido', informe: 'Informe' }

/**
 * Busca en lo que Orbe guarda en este PC (M2): conversaciones pasadas, recuerdos, métricas y contenido. Devuelve los
 * fragmentos; el modelo hace el resumen. Es de solo lectura y no sale del equipo.
 */
export function crearHerramientaBuscarMemoria(buscar: (consulta: string, tipos?: TipoDoc[]) => ResultadoBusqueda[]): Herramienta {
  return definirHerramienta<{ consulta: string; en?: string }>({
    nombre: 'buscar_memoria',
    descripcion:
      'Busca en lo que Orbe tiene guardado en este PC: conversaciones pasadas con el usuario, sus recuerdos, el historial de métricas ' +
      'de Instagram y el contenido de sus marcas. Úsala cuando pregunte por algo que hablasteis antes («¿qué te dije de…?») o por datos ' +
      'suyos guardados, y resume lo encontrado citando de dónde sale y su fecha. Las cifras que cambian (seguidores, precios) pueden ' +
      'estar viejas: si importan, vuelve a consultarlas.',
    esquema: crearEsquema(campos),
    nivel: 'libre',
    validar: crearValidador<{ consulta: string; en?: string }>(campos),
    describir: (e) => `Buscando en la memoria: ${e.consulta}`,
    async ejecutar(e) {
      const r = buscar(e.consulta, e.en ? [TIPO[e.en]!] : undefined)
      if (r.length === 0) return { texto: `No hay nada guardado que coincida con «${e.consulta}».` }
      const texto = r
        .map((x) => `- ${NOMBRE[x.tipo]} «${x.titulo}»${x.fecha ? ` (${x.fecha.slice(0, 10)})` : ''}: ${x.fragmento.replace(/\s+/g, ' ')}`)
        .join('\n')
      // Las conversaciones guardan respuestas que pudieron citar webs: se entrega como contenido de fuera.
      return { texto, externo: { origen: 'Historial y memoria de Orbe' } }
    }
  })
}
