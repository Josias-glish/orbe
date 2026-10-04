import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MensajeGuardado } from '../../shared/tipos'
import { neutralizarEtiquetas } from '../chat/contenido'

export const MAX_MENSAJES_GUARDADOS = 40
export const MAX_CARACTERES_MENSAJE = 8000

interface ArchivoConversacion {
  version: 1
  actualizada: string
  mensajes: MensajeGuardado[]
}

const esMensaje = (m: unknown): m is MensajeGuardado =>
  typeof m === 'object' &&
  m !== null &&
  ((m as MensajeGuardado).rol === 'usuario' || (m as MensajeGuardado).rol === 'asistente') &&
  typeof (m as MensajeGuardado).texto === 'string'

/**
 * La conversación en curso, guardada en disco solo como texto (sin capturas ni contenido de pantalla)
 * para poder seguir donde se dejó tras cerrar y abrir Orbe. «Nueva conversación» la borra.
 */
export class AlmacenConversacion {
  constructor(
    private readonly archivo: string,
    private readonly maxMensajes = MAX_MENSAJES_GUARDADOS
  ) {}

  cargar(): MensajeGuardado[] {
    try {
      const datos = JSON.parse(readFileSync(this.archivo, 'utf8')) as Partial<ArchivoConversacion>
      return Array.isArray(datos.mensajes) ? datos.mensajes.filter(esMensaje) : []
    } catch {
      return []
    }
  }

  hay(): boolean {
    return this.cargar().length > 0
  }

  /** Añade un intercambio completo (lo que escribió el usuario y lo que respondió Orbe). */
  anexar(usuario: string, asistente: string, ahora: Date = new Date()): void {
    const recorta = (t: string): string =>
      t.length <= MAX_CARACTERES_MENSAJE ? t : `${t.slice(0, MAX_CARACTERES_MENSAJE).trimEnd()}…`
    const mensajes = [
      ...this.cargar(),
      { rol: 'usuario' as const, texto: recorta(usuario) },
      { rol: 'asistente' as const, texto: recorta(asistente) }
    ].slice(-this.maxMensajes)
    // Siempre empieza por un mensaje del usuario, para que la conversación tenga sentido.
    while (mensajes.length > 0 && mensajes[0].rol !== 'usuario') mensajes.shift()

    const datos: ArchivoConversacion = { version: 1, actualizada: ahora.toISOString(), mensajes }
    mkdirSync(dirname(this.archivo), { recursive: true })
    const temporal = `${this.archivo}.tmp`
    writeFileSync(temporal, JSON.stringify(datos), 'utf8')
    renameSync(temporal, this.archivo)
  }

  vaciar(): void {
    if (existsSync(this.archivo)) rmSync(this.archivo, { force: true })
  }
}

export const HISTORIAL_PREVIO_MAX = 6000
const POR_MENSAJE_USUARIO = 1200
const POR_MENSAJE_ASISTENTE = 1500

const recortarMensaje = (t: string, max: number): string => (t.length <= max ? t : `${t.slice(0, max).trimEnd()}… (recortado)`)

/**
 * Lo que se le cuenta al modelo de la conversación anterior: los últimos mensajes que quepan en `max`
 * caracteres, como «Usuario: …» y «Orbe: …». Null si no hay nada.
 */
export function construirHistorialPrevio(mensajes: MensajeGuardado[], max = HISTORIAL_PREVIO_MAX): string | null {
  const lineas: string[] = []
  let usados = 0
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i]
    const cabeza = m.rol === 'usuario' ? 'Usuario' : 'Orbe'
    const linea = `${cabeza}: ${neutralizarEtiquetas(recortarMensaje(m.texto, m.rol === 'usuario' ? POR_MENSAJE_USUARIO : POR_MENSAJE_ASISTENTE))}`
    if (usados + linea.length + 1 > max && lineas.length > 0) break
    usados += linea.length + 1
    lineas.unshift(linea)
  }
  // No empezar a media conversación con una respuesta sin su pregunta.
  while (lineas.length > 0 && lineas[0].startsWith('Orbe: ')) lineas.shift()
  if (lineas.length === 0) return null
  return (
    'Esto es lo último de tu conversación anterior con el usuario (se guardó al cerrar Orbe). ' +
    'Es solo contexto para que puedas continuar donde lo dejasteis.\n' +
    lineas.join('\n')
  )
}
