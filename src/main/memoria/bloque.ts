import type { TipoMemoria } from '../../shared/tipos'
import { neutralizarEtiquetas } from '../chat/contenido'
import { ETIQUETA_TIPO } from './formato'

/** Lo que el constructor del bloque necesita saber de cada recuerdo. */
export interface RecuerdoParaPrompt {
  id: string
  tipo: TipoMemoria
  descripcion: string
  cuerpo: string
  usar: boolean
  completo: boolean
  modificado: string
}

export interface BloqueMemoria {
  /** El bloque listo para el prompt (con su introducción); vacío si no hay nada que enviar. */
  texto: string
  /** Caracteres de recuerdos que entran (sin contar la introducción). */
  usados: number
  /** Recuerdos que se quedaron fuera por falta de espacio. */
  omitidos: number
  /** Lo que ocupa cada recuerdo que entra, por id. */
  porRecuerdo: Record<string, number>
}

/** Primero quién es el usuario, luego lo que pidió recordar, luego preferencias y por último proyectos. */
const PRIORIDAD: Record<TipoMemoria, number> = { usuario: 0, nota: 1, preferencia: 2, proyecto: 3 }

export const INTRODUCCION_MEMORIA =
  'Memoria del usuario\n' +
  'Notas que el usuario ha guardado en Orbe o ha traído de su memoria de Claude. Son contexto sobre quién es, qué le gusta y en qué trabaja: ' +
  'úsalas con naturalidad solo cuando vengan al caso, sin recitarlas ni decir que las tienes salvo que te lo pregunte. ' +
  'Si la conversación las contradice, manda la conversación.'

/** Quita lo que solo tiene sentido dentro de la memoria de Claude (enlaces entre notas) y neutraliza etiquetas propias. */
export function limpiarParaPrompt(texto: string): string {
  return neutralizarEtiquetas(
    texto
      .replace(/\s*\bVer\s+\[\[[^\]]+\]\](?:\s*(?:,|y)\s*\[\[[^\]]+\]\])*\.?/g, '')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

function renderizar(r: RecuerdoParaPrompt, completo: boolean): string {
  const titulo = limpiarParaPrompt(r.descripcion)
  const cabeza = `- [${ETIQUETA_TIPO[r.tipo]}] ${titulo}`
  if (!completo) return cabeza
  const cuerpo = limpiarParaPrompt(r.cuerpo)
  if (!cuerpo || cuerpo === titulo) return cabeza
  return `${cabeza}\n${cuerpo.replace(/^(?=.)/gm, '  ')}`
}

/**
 * Arma el bloque de memoria con un presupuesto de caracteres. Entran primero los recuerdos más importantes;
 * si uno completo no cabe, se prueba con su resumen, y si tampoco, se deja fuera (y se cuenta).
 */
export function construirBloqueMemoria(recuerdos: RecuerdoParaPrompt[], max: number): BloqueMemoria {
  const candidatos = recuerdos
    .filter((r) => r.usar && (r.descripcion.trim() || r.cuerpo.trim()))
    .sort((a, b) => PRIORIDAD[a.tipo] - PRIORIDAD[b.tipo] || b.modificado.localeCompare(a.modificado))

  const lineas: string[] = []
  const porRecuerdo: Record<string, number> = {}
  let usados = 0
  let omitidos = 0

  for (const r of candidatos) {
    const opciones = r.completo ? [renderizar(r, true), renderizar(r, false)] : [renderizar(r, false)]
    const elegida = opciones.find((t) => usados + t.length + (lineas.length ? 1 : 0) <= max)
    if (elegida === undefined) {
      omitidos++
      continue
    }
    usados += elegida.length + (lineas.length ? 1 : 0)
    porRecuerdo[r.id] = elegida.length
    lineas.push(elegida)
  }

  if (lineas.length === 0) return { texto: '', usados: 0, omitidos, porRecuerdo }
  if (omitidos > 0) {
    lineas.push(omitidos === 1 ? '(Hay 1 nota más que no cabe aquí.)' : `(Hay ${omitidos} notas más que no caben aquí.)`)
  }
  return {
    texto: `${INTRODUCCION_MEMORIA}\n<memoria>\n${lineas.join('\n')}\n</memoria>`,
    usados,
    omitidos,
    porRecuerdo
  }
}
