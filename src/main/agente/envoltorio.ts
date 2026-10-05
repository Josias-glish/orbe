import { randomBytes } from 'node:crypto'
import { neutralizarEtiquetas } from '../chat/contenido'

/** Marca única por tarea: una página no puede adivinarla, así que no puede cerrar el bloque ni fabricar otro igual. */
export function crearNonce(): string {
  return randomBytes(6).toString('hex')
}

function escaparAtributo(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface OpcionesEnvoltorio {
  origen: string
  url?: string
  nonce: string
}

/**
 * Entrega al modelo contenido de fuera (una página, un buscador) como datos: dentro de un bloque marcado con la
 * marca única de la tarea y con las etiquetas propias neutralizadas. El prompt de sistema le dice que lo de dentro
 * nunca son instrucciones.
 */
export function envolverExterno(texto: string, { origen, url, nonce }: OpcionesEnvoltorio): string {
  const atributos = [`origen="${escaparAtributo(origen)}"`]
  if (url) atributos.push(`url="${escaparAtributo(url)}"`)
  atributos.push(`id="${nonce}"`)
  return `<contenido_externo ${atributos.join(' ')}>\n${neutralizarEtiquetas(texto)}\n</contenido_externo id="${nonce}">`
}
