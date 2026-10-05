import { existsSync, readFileSync } from 'node:fs'
import { NIVELES_ESFUERZO } from '../shared/tipos'
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
export const URL_OPENAI_POR_DEFECTO = 'https://api.openai.com/v1'
/** El estilo por defecto de la voz neuronal: un mayordomo digital sereno y elegante (sin imitar a nadie en concreto). */
export const INSTRUCCIONES_VOZ_POR_DEFECTO =
  'Habla en español con un tono sereno, elegante y ligeramente británico, como un mayordomo digital muy competente: ' +
  'voz grave y pausada, cortés, con un toque de ingenio discreto. Sin exagerar ni dramatizar.'
export const ESFUERZO_POR_DEFECTO: Esfuerzo = 'medium'
export const ESFUERZOS: readonly Esfuerzo[] = NIVELES_ESFUERZO
export const PASOS_AGENTE_POR_DEFECTO = 15
export const BUSQUEDAS_MAX_POR_DEFECTO = 5

export interface Config {
  proveedor: 'cli' | 'api' | 'openai'
  modelo: string
  esfuerzo: Esfuerzo
  /** Solo se rellena si el proveedor es la API. Nunca debe salir del proceso principal. */
  apiKey: string
  rutaCli: string
  /** Solo para el proveedor `openai` (cualquier API compatible: OpenAI, Groq, OpenRouter, Ollama…). */
  openaiUrl: string
  /** Puede quedar vacía con servidores locales. Nunca debe salir del proceso principal. */
  openaiKey: string
  /** Dictado por micrófono: servicio de transcripción compatible con `/audio/transcriptions`. */
  dictado: { disponible: boolean; url: string; clave: string; modelo: string; idioma: string }
  /** Voz neuronal para leer las respuestas: servicio compatible con `/audio/speech` (OpenAI y similares). */
  voz: { disponible: boolean; url: string; clave: string; modelo: string; voz: string; instrucciones: string }
  /** Máximo de caracteres de contexto de pantalla que se envían (selección o contenido de la ventana). */
  contextoMax: number
  atajoPanel: string
  atajoLeer: string
  /** Carpeta con las imágenes que se usan de fondo del chat; vacía si no hay. */
  fondosCarpeta: string
  /** Máximo de caracteres de recuerdos que viajan en cada conversación. */
  memoriaMax: number
  /** Carpetas de memoria de Claude de donde importar; null = las de Claude Code (`~/.claude/projects/*\/memory`). */
  memoriaOrigenes: string[] | null
  /** Modo agente: Claude (u otro modelo con herramientas) puede buscar, abrir y navegar. Solo con los proveedores `api` y `openai`. */
  agente: {
    /** ORBE_AGENTE: encendido salvo que se apague con 0/no/off. */
    activo: boolean
    /** Máximo de rondas de herramientas por tarea. */
    pasos: number
    /** Máximo de búsquedas web por petición (búsqueda nativa de la API de Claude). */
    busquedaMax: number
    /** Dejar que el agente llegue a localhost y a redes privadas (apagado por defecto). */
    permitirLocal: boolean
  }
  avisos: string[]
}

/** Lee un valor tipo sí/no del .env; devuelve `undefined` si no es ninguno de los reconocidos. */
export function leerBooleano(valor: string): boolean | undefined {
  const v = valor.trim().toLowerCase()
  if (/^(1|true|si|sí|yes|on|auto)$/.test(v)) return true
  if (/^(0|false|no|off)$/.test(v)) return false
  return undefined
}

/**
 * Decide la configuración a partir de los valores del .env y del entorno del proceso.
 * Con ORBE_PROVEEDOR=auto (por defecto) se usa la API solo si hay una ANTHROPIC_API_KEY en el .env;
 * una variable de entorno global no cambia de proveedor por sorpresa.
 */
export function resolverConfig(delEnv: Record<string, string>, proceso: NodeJS.ProcessEnv = process.env): Config {
  const leer = (clave: string): string => (delEnv[clave] ?? proceso[clave] ?? '').trim()
  const avisos: string[] = []

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

  let pasosAgente = PASOS_AGENTE_POR_DEFECTO
  const pasosLeidos = leer('ORBE_AGENTE_PASOS')
  if (pasosLeidos) {
    const n = Number(pasosLeidos)
    if (Number.isInteger(n) && n >= 1 && n <= 25) pasosAgente = n
    else avisos.push(`ORBE_AGENTE_PASOS="${pasosLeidos}" no es válido (un entero entre 1 y 25); uso ${pasosAgente}.`)
  }

  let busquedaMax = BUSQUEDAS_MAX_POR_DEFECTO
  const busquedaLeida = leer('ORBE_BUSQUEDA_MAX')
  if (busquedaLeida) {
    const n = Number(busquedaLeida)
    if (Number.isInteger(n) && n >= 1 && n <= 10) busquedaMax = n
    else avisos.push(`ORBE_BUSQUEDA_MAX="${busquedaLeida}" no es válido (un entero entre 1 y 10); uso ${busquedaMax}.`)
  }

  const agenteLeido = leer('ORBE_AGENTE')
  let agenteActivo = true
  if (agenteLeido) {
    const b = leerBooleano(agenteLeido)
    if (b === undefined) avisos.push(`ORBE_AGENTE="${agenteLeido}" no es válido (auto, 1 o 0); lo dejo activo.`)
    else agenteActivo = b
  }

  const permitirLocalLeido = leer('ORBE_PERMITIR_LOCAL')
  let permitirLocal = false
  if (permitirLocalLeido) {
    const b = leerBooleano(permitirLocalLeido)
    if (b === undefined) avisos.push(`ORBE_PERMITIR_LOCAL="${permitirLocalLeido}" no es válido (1 o 0); queda apagado.`)
    else permitirLocal = b
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
  let proveedor: 'cli' | 'api' | 'openai'
  if (eleccion === 'cli') proveedor = 'cli'
  else if (eleccion === 'api') proveedor = 'api'
  else if (eleccion === 'openai') proveedor = 'openai'
  else {
    if (eleccion !== 'auto') avisos.push(`ORBE_PROVEEDOR="${eleccion}" no es válido (auto, cli, api, openai); uso auto.`)
    proveedor = claveEnArchivo ? 'api' : 'cli'
  }

  // Con `openai` el modelo hay que elegirlo: el de Claude por defecto no existiría en ese servicio.
  const modelo = leer('ORBE_MODELO') || (proveedor === 'openai' ? '' : MODELO_POR_DEFECTO)
  if (proveedor === 'openai' && !modelo) avisos.push('ORBE_PROVEEDOR=openai necesita ORBE_MODELO (por ejemplo gpt-4o-mini).')

  const openaiUrl = leer('ORBE_OPENAI_URL') || URL_OPENAI_POR_DEFECTO
  const openaiKey = leer('ORBE_OPENAI_KEY') || leer('OPENAI_API_KEY')
  const urlDictado = leer('ORBE_STT_URL')
  // La clave del chat solo sirve de respaldo para el mismo servicio: nunca se manda a otra dirección distinta.
  const sinBarra = (url: string): string => url.replace(/\/+$/, '')
  const mismoServicio = (url: string): boolean => !url || sinBarra(url) === sinBarra(openaiUrl)
  const claveDictado = leer('ORBE_STT_KEY') || (mismoServicio(urlDictado) ? openaiKey : '')
  const urlVoz = leer('ORBE_TTS_URL')
  const claveVoz = leer('ORBE_TTS_KEY') || (mismoServicio(urlVoz) ? openaiKey : '')

  return {
    proveedor,
    modelo,
    esfuerzo,
    apiKey: proveedor === 'api' ? claveEnArchivo || leer('ANTHROPIC_API_KEY') : '',
    rutaCli: leer('CLAUDE_CLI_PATH'),
    openaiUrl,
    openaiKey: proveedor === 'openai' ? openaiKey : '',
    dictado: {
      // Con clave (la de OpenAI sirve) o con un servidor propio (ORBE_STT_URL, p. ej. un Whisper local).
      disponible: Boolean(claveDictado) || Boolean(urlDictado),
      url: urlDictado || openaiUrl,
      clave: claveDictado,
      modelo: leer('ORBE_STT_MODELO') || 'whisper-1',
      idioma: leer('ORBE_STT_IDIOMA') || 'es'
    },
    voz: {
      // La clave de otro servicio (p. ej. Groq en ORBE_OPENAI_KEY) no vale para la voz de OpenAI: sin ORBE_TTS_*, solo cuenta con el OpenAI de verdad.
      disponible: Boolean(urlVoz) || (Boolean(claveVoz) && (Boolean(leer('ORBE_TTS_KEY')) || openaiUrl === URL_OPENAI_POR_DEFECTO)),
      url: urlVoz || openaiUrl,
      clave: claveVoz,
      modelo: leer('ORBE_TTS_MODELO') || 'gpt-4o-mini-tts',
      voz: leer('ORBE_TTS_VOZ') || 'onyx',
      instrucciones: leer('ORBE_TTS_INSTRUCCIONES') || INSTRUCCIONES_VOZ_POR_DEFECTO
    },
    contextoMax,
    atajoPanel: leer('ORBE_ATAJO_PANEL') || ATAJO_PANEL_POR_DEFECTO,
    atajoLeer: leer('ORBE_ATAJO_LEER') || ATAJO_LEER_POR_DEFECTO,
    fondosCarpeta: leer('ORBE_FONDOS'),
    memoriaMax,
    memoriaOrigenes,
    agente: { activo: agenteActivo, pasos: pasosAgente, busquedaMax, permitirLocal },
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
