import { randomUUID } from 'node:crypto'
import { esIdExpresion } from '../../shared/expresiones'
import type { EventoActividad, TipoActividad } from '../../shared/tipos'

export const TIPOS_ACTIVIDAD: readonly TipoActividad[] = ['inicio', 'trabajando', 'esperando', 'terminado', 'error', 'info']
export const HISTORIAL_MAX = 50
const ORIGEN_MAX = 40
const TITULO_MAX = 140
const DETALLE_MAX = 400

/** Quita invisibles y saltos raros, junta espacios y recorta. Lo que llega de fuera nunca se muestra tal cual. */
export function limpiarCampo(valor: unknown, max: number): string {
  if (typeof valor !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  const limpio = valor.replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g, '').replace(/\s+/g, ' ').trim()
  return limpio.length > max ? `${limpio.slice(0, max - 1)}…` : limpio
}

/**
 * Convierte lo que manda un conector en un evento seguro: tipo de la lista, textos limpios y cortos, origen con
 * caracteres simples. Devuelve null si no tiene lo mínimo (un título).
 */
export function normalizarEvento(entrada: unknown, origenPorDefecto = 'externo'): EventoActividad | null {
  if (typeof entrada !== 'object' || entrada === null) return null
  const o = entrada as Record<string, unknown>
  const titulo = limpiarCampo(o['titulo'] ?? o['title'], TITULO_MAX)
  if (!titulo) return null
  const tipoLeido = typeof o['tipo'] === 'string' ? o['tipo'] : typeof o['type'] === 'string' ? o['type'] : 'info'
  const tipo = (TIPOS_ACTIVIDAD as readonly string[]).includes(tipoLeido) ? (tipoLeido as TipoActividad) : 'info'
  const origen = limpiarCampo(o['origen'] ?? o['source'] ?? origenPorDefecto, ORIGEN_MAX).replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]/g, '') || origenPorDefecto
  const detalle = limpiarCampo(o['detalle'] ?? o['detail'], DETALLE_MAX)
  const expresion = o['expresion'] ?? o['expression']
  return {
    id: randomUUID(),
    origen,
    tipo,
    titulo,
    ...(detalle ? { detalle } : {}),
    ...(esIdExpresion(expresion) ? { expresion } : {}),
    cuando: Date.now()
  }
}

/** Guarda los últimos eventos y avisa a quien escuche (la ventana de Orbe). */
export class BusActividad {
  private readonly historial: EventoActividad[] = []
  private readonly oyentes = new Set<(evento: EventoActividad) => void>()

  publicar(evento: EventoActividad): void {
    this.historial.push(evento)
    if (this.historial.length > HISTORIAL_MAX) this.historial.splice(0, this.historial.length - HISTORIAL_MAX)
    for (const oyente of this.oyentes) {
      try {
        oyente(evento)
      } catch {
        // un oyente roto no impide avisar a los demás
      }
    }
  }

  suscribir(oyente: (evento: EventoActividad) => void): () => void {
    this.oyentes.add(oyente)
    return () => this.oyentes.delete(oyente)
  }

  ultimos(): EventoActividad[] {
    return this.historial.map((e) => ({ ...e }))
  }
}
