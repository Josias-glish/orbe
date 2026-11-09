import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { Decision } from './tipos'

/**
 * Cómo se comporta Orbe con cada acción de un conector (como en dots): `libre` la hace sin preguntar,
 * `si_lo_pediste` solo sin preguntar si tu orden la nombraba, `preguntar` siempre pide permiso y `tu_lo_haces` lo deja
 * preparado para que lo hagas tú. `bloqueado` no se hace nunca.
 */
export const MODOS = ['libre', 'si_lo_pediste', 'preguntar', 'tu_lo_haces', 'bloqueado'] as const
export type Modo = (typeof MODOS)[number]

export function esModo(valor: unknown): valor is Modo {
  return typeof valor === 'string' && (MODOS as readonly string[]).includes(valor)
}

/**
 * Lo mínimo que ningún `reglas.json` puede relajar. Protege tus cuentas: publicar o responder en tu nombre siempre
 * pide permiso, y lo que puede suspender una cuenta de Meta (seguir, dar me gusta, comentar en cuentas ajenas) o no
 * tiene vuelta atrás (pagos, contraseñas, borrar publicaciones) está bloqueado.
 */
export const MINIMO: Readonly<Record<string, Modo>> = {
  'ig.publicar': 'preguntar',
  'ig.responder_comentario': 'preguntar',
  'ig.responder_mensaje': 'preguntar',
  'ig.borrar_publicacion': 'bloqueado',
  'ig.seguir': 'bloqueado',
  'ig.me_gusta': 'bloqueado',
  'ig.comentar_ajeno': 'bloqueado',
  'gmail.enviar': 'bloqueado',
  'navegador.comprar': 'bloqueado',
  'navegador.contrasena': 'bloqueado'
}

/** El `reglas.json` que se crea la primera vez (si ya existe, nunca se toca). */
export const REGLAS_POR_DEFECTO: Readonly<Record<string, Modo>> = {
  'gmail.leer': 'libre',
  'gmail.borrador': 'si_lo_pediste',
  'ig.leer': 'libre',
  'ig.publicar': 'preguntar',
  'ig.responder_comentario': 'preguntar',
  'ig.responder_mensaje': 'preguntar',
  'ig.ocultar_comentario': 'preguntar',
  'ig.borrar_comentario': 'tu_lo_haces',
  'navegador.leer': 'libre',
  'navegador.escribir': 'preguntar',
  'navegador.enviar': 'preguntar',
  'navegador.comprar': 'bloqueado'
}

export const BLOQUEADAS_SIEMPRE = [
  'cambiar contraseñas o correos de recuperación',
  'pagos y compras',
  'borrar cuentas o publicaciones',
  'escribir en campos de contraseña',
  'seguir, dar me gusta o comentar en cuentas ajenas',
  'enviar correos'
]

/** El modo efectivo: el de las reglas (lo desconocido, se pregunta), pero nunca por debajo del mínimo. */
export function modoDe(accion: string, reglas: Readonly<Record<string, Modo>>): Modo {
  const elegido = Object.prototype.hasOwnProperty.call(reglas, accion) ? reglas[accion]! : 'preguntar'
  const minimo = MINIMO[accion] ?? 'libre'
  return MODOS.indexOf(elegido) >= MODOS.indexOf(minimo) ? elegido : minimo
}

/** Palabras que, en tu orden, cuentan como haber pedido la acción. */
const PISTAS: Readonly<Record<string, RegExp>> = {
  'gmail.borrador': /\b(borrador|borradores|responde|contesta|redacta)\b/i,
  'ig.responder_comentario': /\b(responde|contesta)\b.*\bcomentarios?\b/i
}

/**
 * «si_lo_pediste»: solo vale si tu orden (no el texto de un correo o una web) nombra la acción. Se decide con la orden
 * original de la tarea, que el modelo no puede reescribir. Sin orden, no cuenta como pedido.
 */
export function pedidoExplicito(accion: string, ordenUsuario: string | undefined): boolean {
  if (!ordenUsuario) return false
  return PISTAS[accion]?.test(ordenUsuario) ?? false
}

/** Traduce el modo de una acción en lo que hace la política. */
export function decisionPorRegla(accion: string, modo: Modo, titulo: string, ordenUsuario?: string): Decision {
  switch (modo) {
    case 'libre':
      return { tipo: 'permitir' }
    case 'si_lo_pediste':
      return pedidoExplicito(accion, ordenUsuario)
        ? { tipo: 'permitir' }
        : { tipo: 'confirmar', titulo, detalle: 'No me lo pediste expresamente, así que te pido permiso.' }
    case 'preguntar':
      return { tipo: 'confirmar', titulo, detalle: 'Esta acción necesita tu permiso.' }
    case 'tu_lo_haces':
      return { tipo: 'prohibir', motivo: 'Esta acción la haces tú: te lo dejo preparado para que lo hagas desde la aplicación.' }
    case 'bloqueado':
      return { tipo: 'prohibir', motivo: 'Esta acción está bloqueada en Orbe para proteger tus cuentas.' }
  }
}

/**
 * Lee `reglas.json`. Lo que no se entiende se ignora (y esa acción se pregunta); si el archivo falta o está roto,
 * valen las reglas por defecto. Nunca escribe.
 */
export function leerReglas(ruta: string): Record<string, Modo> {
  if (!existsSync(ruta)) return { ...REGLAS_POR_DEFECTO }
  let datos: unknown
  try {
    datos = JSON.parse(readFileSync(ruta, 'utf8').replace(/^﻿/, ''))
  } catch {
    console.warn('[orbe] reglas.json no es un JSON válido: uso las reglas por defecto.')
    return { ...REGLAS_POR_DEFECTO }
  }
  const lista = (datos as { reglas?: unknown } | null)?.reglas
  if (!Array.isArray(lista)) return { ...REGLAS_POR_DEFECTO }
  const reglas: Record<string, Modo> = {}
  for (const r of lista) {
    const accion = (r as { accion?: unknown } | null)?.accion
    const modo = (r as { modo?: unknown } | null)?.modo
    if (typeof accion === 'string' && /^[a-z_]+\.[a-z_]+$/.test(accion) && esModo(modo)) reglas[accion] = modo
  }
  return reglas
}

/** Crea `reglas.json` con las reglas por defecto si no existe. Si ya existe, no lo toca. Devuelve si lo creó. */
export function asegurarReglas(ruta: string): boolean {
  if (existsSync(ruta)) return false
  const contenido = {
    version: 1,
    reglas: Object.entries(REGLAS_POR_DEFECTO).map(([accion, modo]) => ({ accion, modo })),
    bloqueadas_siempre: BLOQUEADAS_SIEMPRE
  }
  writeFileSync(ruta + '.tmp', JSON.stringify(contenido, null, 2) + '\n', 'utf8')
  renameSync(ruta + '.tmp', ruta)
  return true
}
