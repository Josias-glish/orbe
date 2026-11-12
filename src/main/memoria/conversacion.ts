import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ConversacionArchivada, MensajeGuardado } from '../../shared/tipos'
import { neutralizarEtiquetas } from '../chat/contenido'

export const MAX_MENSAJES_GUARDADOS = 40
export const MAX_CARACTERES_MENSAJE = 8000

interface ArchivoConversacion {
  version: 1
  actualizada: string
  mensajes: MensajeGuardado[]
  /** Si salió del historial, su archivo allí (al archivarla otra vez se sobrescribe, sin duplicados). */
  id?: string
}

const ID_VALIDO = /^[\w-]{1,40}$/

/** El título de una conversación: su primera pregunta, en una línea. */
export function tituloDe(mensajes: MensajeGuardado[]): string {
  const t = (mensajes.find((m) => m.rol === 'usuario')?.texto ?? 'Conversación').replace(/\s+/g, ' ').trim()
  return t.length <= 60 ? t : `${t.slice(0, 59).trimEnd()}…`
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
  /** Carpeta del historial: una conversación archivada por archivo. */
  private readonly carpeta: string

  constructor(
    private readonly archivo: string,
    private readonly maxMensajes = MAX_MENSAJES_GUARDADOS
  ) {
    this.carpeta = join(dirname(archivo), 'conversaciones')
  }

  private leer(ruta: string): Partial<ArchivoConversacion> | null {
    try {
      return JSON.parse(readFileSync(ruta, 'utf8')) as Partial<ArchivoConversacion>
    } catch {
      return null
    }
  }

  private escribir(ruta: string, datos: ArchivoConversacion): void {
    mkdirSync(dirname(ruta), { recursive: true })
    const temporal = `${ruta}.tmp`
    writeFileSync(temporal, JSON.stringify(datos), 'utf8')
    renameSync(temporal, ruta)
  }

  cargar(): MensajeGuardado[] {
    const datos = this.leer(this.archivo)
    return Array.isArray(datos?.mensajes) ? datos.mensajes.filter(esMensaje) : []
  }

  /** Guarda la conversación en curso en el historial (si tiene algo). No la borra de aquí. */
  archivar(ahora: Date = new Date()): void {
    const mensajes = this.cargar()
    if (mensajes.length === 0) return
    const previo = this.leer(this.archivo)?.id
    const id = previo && ID_VALIDO.test(previo) ? previo : ahora.toISOString().replace(/[:.]/g, '-')
    this.escribir(join(this.carpeta, `${id}.json`), { version: 1, actualizada: ahora.toISOString(), mensajes, id })
  }

  /** Todas con sus mensajes (las archivadas y la de ahora, con id «actual»), para el índice de búsqueda. */
  todas(): Array<{ id: string; actualizada: string; mensajes: MensajeGuardado[] }> {
    const leerDe = (ruta: string, id: string): { id: string; actualizada: string; mensajes: MensajeGuardado[] } => {
      const d = this.leer(ruta)
      return { id, actualizada: String(d?.actualizada ?? ''), mensajes: Array.isArray(d?.mensajes) ? d.mensajes.filter(esMensaje) : [] }
    }
    let archivos: string[] = []
    try {
      archivos = readdirSync(this.carpeta).filter((f) => f.endsWith('.json'))
    } catch {
      // sin historial todavía
    }
    return [leerDe(this.archivo, 'actual'), ...archivos.map((f) => leerDe(join(this.carpeta, f), f.slice(0, -5)))].filter((c) => c.mensajes.length > 0)
  }

  /** El historial, de la más reciente a la más antigua. */
  listar(): ConversacionArchivada[] {
    let archivos: string[] = []
    try {
      archivos = readdirSync(this.carpeta).filter((f) => f.endsWith('.json'))
    } catch {
      return []
    }
    return archivos
      .map((f) => {
        const d = this.leer(join(this.carpeta, f))
        const mensajes = Array.isArray(d?.mensajes) ? d.mensajes.filter(esMensaje) : []
        return { id: f.slice(0, -5), titulo: tituloDe(mensajes), actualizada: String(d?.actualizada ?? ''), mensajes: mensajes.length }
      })
      .filter((c) => c.mensajes > 0)
      .sort((a, b) => b.actualizada.localeCompare(a.actualizada))
  }

  /** Reabre una del historial como conversación en curso (la actual se archiva antes). Null si no existe. */
  abrir(id: string, ahora: Date = new Date()): MensajeGuardado[] | null {
    if (!ID_VALIDO.test(id)) return null
    const d = this.leer(join(this.carpeta, `${id}.json`))
    const mensajes = Array.isArray(d?.mensajes) ? d.mensajes.filter(esMensaje) : []
    if (mensajes.length === 0) return null
    this.archivar(ahora)
    this.escribir(this.archivo, { version: 1, actualizada: ahora.toISOString(), mensajes, id })
    return mensajes
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

    const id = this.leer(this.archivo)?.id
    this.escribir(this.archivo, { version: 1, actualizada: ahora.toISOString(), mensajes, ...(id ? { id } : {}) })
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
