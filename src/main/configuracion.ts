import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CANALES, type ConfigVista, type PeticionConfig, type ResultadoConfig } from '../shared/tipos'
import type { Config } from './entorno'

/** Lo único que la pantalla de configuración puede cambiar en el .env. */
export const CLAVES_EDITABLES = [
  'ORBE_PROVEEDOR',
  'ORBE_MODELO',
  'ANTHROPIC_API_KEY',
  'ORBE_OPENAI_URL',
  'ORBE_OPENAI_KEY',
  'ORBE_STT_URL',
  'ORBE_STT_KEY',
  'ORBE_STT_MODELO',
  'ORBE_STT_IDIOMA',
  'ORBE_TTS_URL',
  'ORBE_TTS_KEY',
  'ORBE_TTS_MODELO',
  'ORBE_TTS_VOZ'
] as const

type Cambios = Record<string, string | null>

const LINEA_ACTIVA = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/

/** Un valor se guarda entre comillas si tiene espacios o un «#» (que el lector tomaría por un comentario). */
function formatearValor(valor: string): string {
  return /[\s#]/.test(valor) ? `"${valor}"` : valor
}

/**
 * Aplica cambios a un .env conservando sus comentarios y el resto de líneas: cada clave se reemplaza donde estaba
 * (las repeticiones sobrantes se quitan), `null` la borra y las que no existían se añaden al final.
 */
export function actualizarEnv(texto: string, cambios: Cambios): string {
  const salto = texto.includes('\r\n') ? '\r\n' : '\n'
  const lineas = texto === '' ? [] : texto.split(/\r?\n/)
  if (lineas.length > 0 && lineas[lineas.length - 1] === '') lineas.pop()
  const puestas = new Set<string>()
  const resultado: string[] = []
  for (const linea of lineas) {
    const clave = LINEA_ACTIVA.exec(linea)?.[1]
    if (clave && clave in cambios) {
      const valor = cambios[clave]
      if (valor !== null && !puestas.has(clave)) {
        resultado.push(`${clave}=${formatearValor(valor)}`)
        puestas.add(clave)
      }
      continue
    }
    resultado.push(linea)
  }
  const nuevas = Object.entries(cambios).filter(([clave, valor]) => valor !== null && !puestas.has(clave))
  if (nuevas.length > 0 && resultado.length > 0 && resultado[resultado.length - 1] !== '') resultado.push('')
  for (const [clave, valor] of nuevas) resultado.push(`${clave}=${formatearValor(valor as string)}`)
  return resultado.join(salto) + salto
}

const hayControl = (s: string): boolean => /[\u0000-\u001f\u007f]/.test(s)

function texto(v: unknown, nombre: string, max: number): { ok: true; valor: string } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, valor: '' }
  if (typeof v !== 'string') return { ok: false, error: `${nombre} no es válido.` }
  const t = v.trim()
  if (t.length > max) return { ok: false, error: `${nombre} es demasiado largo.` }
  if (hayControl(t)) return { ok: false, error: `${nombre} tiene caracteres no permitidos.` }
  return { ok: true, valor: t }
}

function url(v: unknown, nombre: string): { ok: true; valor: string } | { ok: false; error: string } {
  const t = texto(v, nombre, 300)
  if (!t.ok || t.valor === '') return t
  try {
    const u = new URL(t.valor)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocolo')
    if (u.username || u.password) throw new Error('credenciales')
  } catch {
    return { ok: false, error: `${nombre} debe ser una dirección web que empiece por https:// (o http:// en un servidor local).` }
  }
  return t
}

/** Una clave nueva (cadena), mantener la que hay (undefined o vacía) o quitarla (null). */
function clave(v: unknown, nombre: string): { ok: true; valor: string | null | undefined } | { ok: false; error: string } {
  if (v === null) return { ok: true, valor: null }
  if (v === undefined) return { ok: true, valor: undefined }
  if (typeof v !== 'string') return { ok: false, error: `${nombre} no es válida.` }
  const t = v.trim()
  if (t === '') return { ok: true, valor: undefined }
  if (t.length > 500 || /\s/.test(t) || hayControl(t)) return { ok: false, error: `${nombre} no parece válida (sin espacios, hasta 500 caracteres).` }
  return { ok: true, valor: t }
}

/** Comprueba lo que manda la interfaz y lo traduce a cambios del .env. */
export function validarPeticion(p: unknown): { ok: true; cambios: Cambios } | { ok: false; error: string } {
  if (typeof p !== 'object' || p === null) return { ok: false, error: 'La configuración no es válida.' }
  const o = p as Record<string, unknown>
  const proveedor = o['proveedor']
  if (proveedor !== 'cli' && proveedor !== 'api' && proveedor !== 'openai') return { ok: false, error: 'El proveedor no es válido.' }
  const dictado = (typeof o['dictado'] === 'object' && o['dictado'] !== null ? o['dictado'] : {}) as Record<string, unknown>
  const voz = (typeof o['voz'] === 'object' && o['voz'] !== null ? o['voz'] : {}) as Record<string, unknown>

  const campos = {
    modelo: texto(o['modelo'], 'El modelo', 120),
    openaiUrl: url(o['openaiUrl'], 'La dirección del servicio'),
    openaiKey: clave(o['openaiKey'], 'La clave del servicio'),
    anthropicKey: clave(o['anthropicKey'], 'La clave de Anthropic'),
    sttUrl: url(dictado['url'], 'La dirección del dictado'),
    sttKey: clave(dictado['clave'], 'La clave del dictado'),
    sttModelo: texto(dictado['modelo'], 'El modelo del dictado', 120),
    sttIdioma: texto(dictado['idioma'], 'El idioma del dictado', 20),
    ttsUrl: url(voz['url'], 'La dirección de la voz'),
    ttsKey: clave(voz['clave'], 'La clave de la voz'),
    ttsModelo: texto(voz['modelo'], 'El modelo de la voz', 120),
    ttsVoz: texto(voz['voz'], 'La voz', 120)
  }
  for (const c of Object.values(campos)) if (!c.ok) return { ok: false, error: c.error }
  const v = Object.fromEntries(Object.entries(campos).map(([k, c]) => [k, (c as { valor: string | null | undefined }).valor])) as {
    [K in keyof typeof campos]: string | null | undefined
  }

  if (proveedor === 'openai' && !v.modelo) return { ok: false, error: 'Con otro proveedor hay que indicar el modelo (por ejemplo gpt-4o-mini).' }

  const cambios: Cambios = { ORBE_PROVEEDOR: proveedor, ORBE_MODELO: v.modelo || null }
  const poner = (nombre: string, valor: string | null | undefined): void => {
    if (valor !== undefined) cambios[nombre] = valor === '' ? null : valor
  }
  poner('ORBE_OPENAI_URL', v.openaiUrl)
  poner('ORBE_OPENAI_KEY', v.openaiKey)
  poner('ANTHROPIC_API_KEY', v.anthropicKey)
  poner('ORBE_STT_URL', v.sttUrl)
  poner('ORBE_STT_KEY', v.sttKey)
  poner('ORBE_STT_MODELO', v.sttModelo)
  poner('ORBE_STT_IDIOMA', v.sttIdioma)
  poner('ORBE_TTS_URL', v.ttsUrl)
  poner('ORBE_TTS_KEY', v.ttsKey)
  poner('ORBE_TTS_MODELO', v.ttsModelo)
  poner('ORBE_TTS_VOZ', v.ttsVoz)
  return { ok: true, cambios }
}

/** Lo que ve la interfaz: valores del .env y qué claves existen, pero nunca las claves. */
export function vistaConfig(config: Config, valores: Record<string, string>): ConfigVista {
  const v = (nombre: string): string => (valores[nombre] ?? '').trim()
  return {
    proveedor: config.proveedor,
    modelo: v('ORBE_MODELO') || config.modelo,
    openaiUrl: v('ORBE_OPENAI_URL'),
    tieneClaveOpenai: Boolean(v('ORBE_OPENAI_KEY') || v('OPENAI_API_KEY')),
    tieneClaveAnthropic: Boolean(v('ANTHROPIC_API_KEY')),
    dictado: { url: v('ORBE_STT_URL'), modelo: v('ORBE_STT_MODELO'), idioma: v('ORBE_STT_IDIOMA'), tieneClave: Boolean(v('ORBE_STT_KEY')) },
    voz: { url: v('ORBE_TTS_URL'), modelo: v('ORBE_TTS_MODELO'), voz: v('ORBE_TTS_VOZ'), tieneClave: Boolean(v('ORBE_TTS_KEY')) }
  }
}

export interface OpcionesConfiguracion {
  ventana: BrowserWindow
  config: Config
  valores: Record<string, string>
  /** El .env donde se guardan los cambios. */
  archivoEnv: string
  /** Reinicia Orbe para aplicar los cambios (la prueba de humo lo sustituye por nada). */
  reiniciar: () => void
  salir: () => void
}

/** Guarda en disco sin dejar el archivo a medias si algo falla a mitad. */
export function escribirEnv(archivo: string, cambios: Cambios): void {
  const actual = existsSync(archivo) ? readFileSync(archivo, 'utf8') : ''
  mkdirSync(dirname(archivo), { recursive: true })
  const temporal = `${archivo}.tmp`
  writeFileSync(temporal, actualizarEnv(actual, cambios), 'utf8')
  renameSync(temporal, archivo)
}

/** Conecta la pantalla de configuración (cambiar de proveedor, claves y voz) con el .env. */
export function registrarConfiguracion(o: OpcionesConfiguracion): void {
  const exigir = (e: IpcMainInvokeEvent): void => {
    if (e.sender !== o.ventana.webContents) throw new Error('Remitente no autorizado')
  }
  ipcMain.handle(CANALES.configLeer, (e): ConfigVista => {
    exigir(e)
    return vistaConfig(o.config, o.valores)
  })
  ipcMain.handle(CANALES.configGuardar, (e, peticion: unknown): ResultadoConfig => {
    exigir(e)
    const r = validarPeticion(peticion)
    if (!r.ok) return r
    try {
      escribirEnv(o.archivoEnv, r.cambios)
    } catch (error) {
      return { ok: false, error: `No se pudo guardar el archivo de configuración: ${error instanceof Error ? error.message : String(error)}` }
    }
    // Se reinicia un instante después, para que la interfaz reciba antes la respuesta.
    setTimeout(o.reiniciar, 400)
    return { ok: true }
  })
  ipcMain.handle(CANALES.appSalir, (e): void => {
    exigir(e)
    setTimeout(o.salir, 100)
  })
}
