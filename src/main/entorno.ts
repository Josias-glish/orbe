import { existsSync, readFileSync } from 'node:fs'
import type { Esfuerzo } from './chat/proveedor'

/** Lee un archivo .env: líneas CLAVE=valor, comentarios con #, valores opcionalmente entre comillas. */
export function parsearEnv(texto: string): Record<string, string> {
  const valores: Record<string, string> = {}
  for (const bruta of texto.split(/\r?\n/)) {
    const linea = bruta.trim()
    if (!linea || linea.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linea)
    if (!m) continue
    let valor = m[2].trim()
    const comilla = valor[0]
    if ((comilla === '"' || comilla === "'") && valor.lastIndexOf(comilla) > 0) {
      valor = valor.slice(1, valor.lastIndexOf(comilla))
    } else {
      // Sin comillas, un « #» inicia un comentario al final de la línea.
      const almohadilla = valor.search(/\s#/)
      if (almohadilla >= 0) valor = valor.slice(0, almohadilla).trim()
    }
    valores[m[1]] = valor
  }
  return valores
}

export interface LecturaEnv {
  valores: Record<string, string>
  /** Archivos que existían y se leyeron, en orden de prioridad. */
  usados: string[]
}

/** Lee varios archivos .env; si una clave está en más de uno, gana el primero de la lista. */
export function leerArchivosEnv(rutas: string[]): LecturaEnv {
  const valores: Record<string, string> = {}
  const usados: string[] = []
  for (const ruta of rutas) {
    if (!existsSync(ruta)) continue
    try {
      const leidos = parsearEnv(readFileSync(ruta, 'utf8'))
      usados.push(ruta)
      for (const [clave, valor] of Object.entries(leidos)) {
        if (!(clave in valores)) valores[clave] = valor
      }
    } catch (error) {
      console.warn(`No se pudo leer ${ruta}:`, error)
    }
  }
  return { valores, usados }
}

export const MODELO_POR_DEFECTO = 'claude-sonnet-5-5'
export const CONTEXTO_MAX_POR_DEFECTO = 8000
export const ATAJO_PANEL_POR_DEFECTO = 'CommandOrControl+Shift+Space'
export const ATAJO_LEER_POR_DEFECTO = 'CommandOrControl+Shift+Alt+Space'
export const MEMORIA_MAX_POR_DEFECTO = 6000
export const ESFUERZO_POR_DEFECTO: Esfuerzo = 'medium'
const ESFUERZOS: readonly Esfuerzo[] = ['low', 'medium', 'high', 'xhigh', 'max']

export interface Config {
  proveedor: 'cli' | 'api'
  modelo: string
  esfuerzo: Esfuerzo
  /** Solo se rellena si el proveedor es la API. Nunca debe salir del proceso principal. */
  apiKey: string
  rutaCli: string
  /** Máximo de caracteres de contexto de pantalla que se envían (selección o contenido de la ventana). */
  contextoMax: number
  atajoPanel: string
  atajoLeer: string
  /** Máximo de caracteres de recuerdos que viajan en cada conversación. */
  memoriaMax: number
  /** Carpetas de memoria de Claude de donde importar; null = las de Claude Code (`~/.claude/projects/*\/memory`). */
  memoriaOrigenes: string[] | null
  avisos: string[]
}

/**
 * Decide la configuración a partir de los valores del .env y del entorno del proceso.
 * Con ORBE_PROVEEDOR=auto (por defecto) se usa la API solo si hay una ANTHROPIC_API_KEY en el .env;
 * una variable de entorno global no cambia de proveedor por sorpresa.
 */
export function resolverConfig(delEnv: Record<string, string>, proceso: NodeJS.ProcessEnv = process.env): Config {
  const leer = (clave: string): string => (delEnv[clave] ?? proceso[clave] ?? '').trim()
  const avisos: string[] = []

  const modelo = leer('ORBE_MODELO') || MODELO_POR_DEFECTO

  let esfuerzo = ESFUERZO_POR_DEFECTO
  const esfuerzoLeido = leer('ORBE_ESFUERZO').toLowerCase()
  if (esfuerzoLeido) {
    if ((ESFUERZOS as readonly string[]).includes(esfuerzoLeido)) esfuerzo = esfuerzoLeido as Esfuerzo
    else avisos.push(`ORBE_ESFUERZO="${esfuerzoLeido}" no es válido (${ESFUERZOS.join(', ')}); uso ${esfuerzo}.`)
  }

  let contextoMax = CONTEXTO_MAX_POR_DEFECTO
  const maxLeido = leer('ORBE_CONTEXTO_MAX')
  if (maxLeido) {
    const n = Number(maxLeido)
    if (Number.isInteger(n) && n >= 500 && n <= 60_000) contextoMax = n
    else avisos.push(`ORBE_CONTEXTO_MAX="${maxLeido}" no es válido (un entero entre 500 y 60000); uso ${contextoMax}.`)
  }

  let memoriaMax = MEMORIA_MAX_POR_DEFECTO
  const memoriaLeida = leer('ORBE_MEMORIA_MAX')
  if (memoriaLeida) {
    const n = Number(memoriaLeida)
    if (Number.isInteger(n) && n >= 1000 && n <= 12_000) memoriaMax = n
    else avisos.push(`ORBE_MEMORIA_MAX="${memoriaLeida}" no es válido (un entero entre 1000 y 12000); uso ${memoriaMax}.`)
  }

  // ORBE_MEMORIA_CLAUDE: carpetas separadas por «;», o «ninguna» para no importar nada.
  let memoriaOrigenes: string[] | null = null
  const origenesLeidos = leer('ORBE_MEMORIA_CLAUDE')
  if (origenesLeidos) {
    memoriaOrigenes = /^(ningun[ao]|none|off)$/i.test(origenesLeidos)
      ? []
      : origenesLeidos
          .split(';')
          .map((c) => c.trim())
          .filter(Boolean)
  }

  const claveEnArchivo = (delEnv['ANTHROPIC_API_KEY'] ?? '').trim()
  const eleccion = leer('ORBE_PROVEEDOR').toLowerCase() || 'auto'
  let proveedor: 'cli' | 'api'
  if (eleccion === 'cli') proveedor = 'cli'
  else if (eleccion === 'api') proveedor = 'api'
  else {
    if (eleccion !== 'auto') avisos.push(`ORBE_PROVEEDOR="${eleccion}" no es válido (auto, cli, api); uso auto.`)
    proveedor = claveEnArchivo ? 'api' : 'cli'
  }

  return {
    proveedor,
    modelo,
    esfuerzo,
    apiKey: proveedor === 'api' ? claveEnArchivo || leer('ANTHROPIC_API_KEY') : '',
    rutaCli: leer('CLAUDE_CLI_PATH'),
    contextoMax,
    atajoPanel: leer('ORBE_ATAJO_PANEL') || ATAJO_PANEL_POR_DEFECTO,
    atajoLeer: leer('ORBE_ATAJO_LEER') || ATAJO_LEER_POR_DEFECTO,
    memoriaMax,
    memoriaOrigenes,
    avisos
  }
}

/** «claude-sonnet-5-5» → «Sonnet 5.5». Si no reconoce el formato, devuelve el id tal cual. */
export function nombreLegibleModelo(modelo: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(modelo)
  if (!m) return modelo
  const familia = m[1][0].toUpperCase() + m[1].slice(1)
  return `${familia} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}
