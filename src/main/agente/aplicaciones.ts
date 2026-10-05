import { basename, extname, join } from 'node:path'

/** Una aplicación que se puede abrir por su nombre. Todo sale del menú Inicio o del archivo del usuario: nunca del modelo. */
export interface EntradaApp {
  /** Nombre tal como lo ve el usuario en el menú Inicio. */
  nombre: string
  /** El nombre sin tildes ni símbolos, para comparar. */
  clave: string
  /** `atajo`: un .lnk del menú Inicio; `tienda`: una app de Microsoft Store; `ruta`: un .exe o .lnk del archivo de alias. */
  origen: 'atajo' | 'tienda' | 'ruta'
  /** Ruta del .lnk o del .exe (origen `atajo` y `ruta`). */
  ruta?: string
  /** Identificador de la app de la Store (origen `tienda`). */
  appId?: string
  /** Por qué no se puede abrir (una consola, la configuración del sistema…); si falta, es abrible. */
  prohibida?: string
}

export interface ConfigApps {
  /** «calculadora» → «Calculadora» (un nombre de la lista) o la ruta completa de un .exe o .lnk. */
  alias: Record<string, string>
  /** Nombres que no se ofrecen aunque estén en el menú Inicio. */
  excluir: string[]
}

export interface DepsCatalogo {
  /** Carpetas «Programas» del menú Inicio (la del usuario primero: gana si un nombre se repite). */
  carpetasInicio: string[]
  listarDirectorio(carpeta: string): Promise<Array<{ nombre: string; esCarpeta: boolean }>>
  /** Destino y argumentos de un acceso directo; null si no se pueden leer. */
  leerAtajo(ruta: string): { destino: string; argumentos: string } | null
  /** Las apps de Microsoft Store del menú Inicio (nombre e identificador). */
  listarAppsTienda(): Promise<Array<{ nombre: string; appId: string }>>
  leerConfiguracion(): Promise<ConfigApps>
  existeArchivo(ruta: string): Promise<boolean>
}

export interface OpcionesCatalogo {
  /** Cuánto vale una lectura del menú Inicio antes de repetirla. */
  vigenciaMs?: number
  ahora?: () => number
}

export type Resolucion =
  | { tipo: 'una'; entrada: EntradaApp }
  | { tipo: 'varias'; candidatas: string[] }
  | { tipo: 'ninguna'; sugerencias: string[] }
  | { tipo: 'prohibida'; motivo: string }

const PROFUNDIDAD_MAX = 4
const MAX_ENTRADAS = 3000
const MAX_CANDIDATAS = 6
const MIN_PARCIAL = 3
/** Una app recién instalada debe poder abrirse: si no aparece, se vuelve a leer el menú, pero no más de una vez cada tanto. */
const REFRESCO_MIN_MS = 30_000

/** Sin tildes, en minúsculas y con espacios simples: «Símbolo del sistema» → «simbolo del sistema». */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // solo las tildes latinas: quitar todas las marcas partiría letras de otros alfabetos (プ → フ)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim()
}

// ---------------------------------------------------------------------------------------------
// Lo que nunca se abre
// ---------------------------------------------------------------------------------------------

/** Consolas, el registro, la configuración del sistema…: abrirlas es dar al agente un camino a cualquier cosa. */
const NOMBRES_PROHIBIDOS: Record<string, string> = {}
const registrarNombres = (motivo: string, nombres: string[]): void => {
  for (const n of nombres) NOMBRES_PROHIBIDOS[normalizar(n)] = motivo
}
registrarNombres('Es una consola de comandos, y no abro consolas ni terminales.', [
  'cmd',
  'cmd.exe',
  'command prompt',
  'símbolo del sistema',
  'powershell',
  'windows powershell',
  'powershell ise',
  'pwsh',
  'terminal',
  'windows terminal',
  'terminal de windows',
  'consola',
  'bash',
  'wsl',
  'ubuntu',
  'git bash'
])
registrarNombres('Es una herramienta de administración del sistema, y no la abro.', [
  'regedit',
  'registry editor',
  'editor del registro',
  'mmc',
  'msconfig',
  'configuración del sistema',
  'administración de equipos',
  'directiva de seguridad local',
  'servicios'
])
registrarNombres('Es la configuración del sistema, y no cambio ajustes de Windows.', [
  'configuración',
  'configuración de windows',
  'settings',
  'windows settings',
  'ajustes',
  'ajustes de windows',
  'panel de control',
  'control panel',
  'control'
])

/** Programas de destino que son consolas, intérpretes o herramientas de administración (sin la extensión). */
const DESTINOS_PROHIBIDOS = new Set([
  'cmd',
  'powershell',
  'powershell_ise',
  'pwsh',
  'wscript',
  'cscript',
  'mshta',
  'regedit',
  'regedt32',
  'mmc',
  'msiexec',
  'rundll32',
  'reg',
  'schtasks',
  'wsl',
  'wslhost',
  'bash',
  'wt',
  'windowsterminal',
  'conhost',
  'control',
  'systemsettings',
  'wmic',
  'msconfig',
  'at',
  'sc',
  'bitsadmin',
  'certutil'
])

/** Extensiones de scripts e instaladores: un acceso directo que apunte a uno ejecuta lo que diga ese archivo. */
const EXTENSIONES_PROHIBIDAS = new Set(['.bat', '.cmd', '.ps1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.hta', '.msi', '.reg', '.scr', '.com', '.pif'])

/** Consolas de administración (.msc) y paneles de control (.cpl). */
const EXTENSIONES_ADMINISTRACION = new Set(['.msc', '.cpl'])

/** Piezas de identificadores de apps de la Store que son consolas o la configuración. */
const APPID_PROHIBIDOS = ['windowsterminal', 'immersivecontrolpanel', 'microsoft.powershell', 'windows.controlpanel', 'systemsettings']

const MOTIVO_CONSOLA = 'Ese acceso directo abre una consola, un intérprete de comandos o una herramienta de administración, y no los abro.'
const MOTIVO_SCRIPT = 'Ese acceso directo ejecuta un script o un instalador, y no los abro.'
const MOTIVO_CONFIG = 'Ese acceso directo abre la configuración del sistema, y no cambio ajustes de Windows.'
const MOTIVO_SIN_DESTINO = 'No puedo comprobar qué abre ese acceso directo, así que no lo abro.'

/** Si el nombre que pidió el modelo es el de una consola o herramienta del sistema: por qué no se abre. */
export function motivoNombreProhibido(nombre: string): string | undefined {
  return NOMBRES_PROHIBIDOS[normalizar(nombre)]
}

/** Si un destino de acceso directo (programa y argumentos) es algo que no se abre: por qué. */
export function motivoDestinoProhibido(destino: string, argumentos = ''): string | undefined {
  const archivo = destino.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const ext = extname(archivo)
  const nombre = ext === '.exe' || ext === '' ? archivo.replace(/\.exe$/, '') : archivo
  if (DESTINOS_PROHIBIDOS.has(nombre) || EXTENSIONES_ADMINISTRACION.has(ext)) return MOTIVO_CONSOLA
  if (EXTENSIONES_PROHIBIDAS.has(ext)) return MOTIVO_SCRIPT
  const args = argumentos.toLowerCase()
  if (/ms-settings:|\.cpl\b|\.msc\b|(^|\s)control(\.exe)?(\s|$)/.test(args)) return MOTIVO_CONFIG
  return undefined
}

export function motivoAppIdProhibido(appId: string): string | undefined {
  const id = appId.toLowerCase()
  if (!APPID_PROHIBIDOS.some((p) => id.includes(p))) return undefined
  return /controlpanel|systemsettings/.test(id) ? MOTIVO_CONFIG : MOTIVO_CONSOLA
}

/** Accesos directos que no son aplicaciones: desinstaladores, ayudas, licencias, sitios web. */
const NO_ES_APLICACION =
  /desinstal|uninstall|d[eé]sinstall|deinstall|卸载|卸載|アンインストール|удал|readme|l[eé]eme|licen[cs]|release notes|notas de la versi|documentaci|documentation|manual de|user guide|gu[ií]a del usuario|\bhelp\b|\bayuda\b|website|sitio web/i

/**
 * Pares de nombres de la misma aplicación de Windows en español e inglés: Windows pone los nombres en su idioma, y el
 * usuario (o el modelo) puede pedirla en el otro. Solo vale si la otra versión está en el menú.
 */
const SINONIMOS: string[][] = [
  ['calculadora', 'calculator'],
  ['bloc de notas', 'notepad'],
  ['explorador de archivos', 'explorador', 'file explorer', 'explorador de windows', 'windows explorer'],
  ['paint', 'pintura'],
  ['reloj', 'alarmas y reloj', 'clock'],
  ['calendario', 'calendar'],
  ['camara', 'camera'],
  ['correo', 'mail'],
  ['fotos', 'photos'],
  ['herramienta recortes', 'herramienta de recortes', 'recortes', 'snipping tool'],
  ['grabadora de sonido', 'grabadora de voz', 'sound recorder'],
  ['notas rapidas', 'notas adhesivas', 'sticky notes'],
  ['tienda', 'microsoft store', 'tienda de microsoft'],
  ['reproductor multimedia', 'media player'],
  ['el tiempo', 'clima', 'weather'],
  ['noticias', 'news'],
  ['teclado en pantalla', 'on screen keyboard'],
  ['lupa', 'magnify', 'magnifier'],
  ['narrador', 'narrator'],
  ['mapa de caracteres', 'character map'],
  ['seguridad de windows', 'windows security'],
  ['peliculas y tv', 'movies tv'],
  ['teams', 'microsoft teams']
].map((grupo) => grupo.map(normalizar))

/**
 * Accesos directos del sistema que no traen programa de destino (apuntan a un elemento del Explorador) pero son inocuos.
 * Los demás sin destino no se abren: no hay forma de comprobar qué lanzan.
 */
const SIN_DESTINO_PERMITIDOS = new Set(['file explorer', 'explorador de archivos', 'windows explorer', 'explorador de windows'].map(normalizar))

// ---------------------------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------------------------

/** Un identificador de app de la Store tiene la forma «Paquete_editor!Aplicacion»; cualquier otra cosa no se usa. */
const APPID_VALIDO = /^[A-Za-z0-9._-]+![A-Za-z0-9._!-]+$/

function esRutaLocalAbsoluta(texto: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(texto)
}

/**
 * Las aplicaciones que Orbe puede abrir por nombre: el menú Inicio (accesos directos y apps de la Store) más los alias del
 * archivo del usuario. Se lee al primer uso y se guarda un rato. El modelo solo elige un nombre: la ruta o el
 * identificador con que se abre salen siempre de aquí.
 */
export class CatalogoAplicaciones {
  private entradas: EntradaApp[] = []
  private config: ConfigApps = { alias: {}, excluir: [] }
  private leidoEn = 0
  private cargando: Promise<void> | null = null
  private readonly vigenciaMs: number
  private readonly ahora: () => number

  constructor(
    private readonly deps: DepsCatalogo,
    opciones: OpcionesCatalogo = {}
  ) {
    this.vigenciaMs = opciones.vigenciaMs ?? 60 * 60_000
    this.ahora = opciones.ahora ?? Date.now
  }

  /** Lee el menú Inicio si no se ha leído, si ya caducó o si se pide a la fuerza. Varias llamadas a la vez comparten la lectura. */
  async cargar(forzar = false): Promise<void> {
    if (!forzar && this.leidoEn > 0 && this.ahora() - this.leidoEn < this.vigenciaMs) return
    this.cargando ??= this.leer().finally(() => {
      this.cargando = null
    })
    await this.cargando
  }

  private async leer(): Promise<void> {
    const [config, atajos, tienda] = await Promise.all([
      this.deps.leerConfiguracion().catch((): ConfigApps => ({ alias: {}, excluir: [] })),
      this.leerAtajos(),
      this.deps.listarAppsTienda().catch(() => [])
    ])
    const excluidas = new Set(config.excluir.map(normalizar))
    const porClave = new Map<string, EntradaApp>()
    const sumar = (e: EntradaApp): void => {
      if (e.clave === '' || excluidas.has(e.clave) || porClave.has(e.clave) || porClave.size >= MAX_ENTRADAS) return
      porClave.set(e.clave, e)
    }
    for (const a of atajos) sumar(a)
    for (const t of tienda) {
      if (!APPID_VALIDO.test(t.appId) || NO_ES_APLICACION.test(t.nombre)) continue
      const motivo = motivoAppIdProhibido(t.appId) ?? motivoNombreProhibido(t.nombre)
      sumar({ nombre: t.nombre, clave: normalizar(t.nombre), origen: 'tienda', appId: t.appId, ...(motivo ? { prohibida: motivo } : {}) })
    }
    this.entradas = [...porClave.values()]
    this.config = config
    this.leidoEn = this.ahora()
  }

  private leerAtajoSeguro(ruta: string): { destino: string; argumentos: string } | null {
    try {
      return this.deps.leerAtajo(ruta)
    } catch {
      return null
    }
  }

  private async leerAtajos(): Promise<EntradaApp[]> {
    const lista: EntradaApp[] = []
    const recorrer = async (carpeta: string, profundidad: number): Promise<void> => {
      const hijos = await this.deps.listarDirectorio(carpeta).catch(() => [])
      for (const h of hijos) {
        const ruta = join(carpeta, h.nombre)
        if (h.esCarpeta) {
          if (profundidad < PROFUNDIDAD_MAX) await recorrer(ruta, profundidad + 1)
          continue
        }
        if (extname(h.nombre).toLowerCase() !== '.lnk') continue
        const nombre = basename(h.nombre, extname(h.nombre))
        if (NO_ES_APLICACION.test(nombre)) continue
        const atajo = this.leerAtajoSeguro(ruta)
        const clave = normalizar(nombre)
        const sinDestino = atajo === null || atajo.destino === ''
        const motivo = sinDestino
          ? SIN_DESTINO_PERMITIDOS.has(clave)
            ? motivoNombreProhibido(nombre)
            : MOTIVO_SIN_DESTINO
          : (motivoDestinoProhibido(atajo.destino, atajo.argumentos) ?? motivoNombreProhibido(nombre))
        lista.push({ nombre, clave, origen: 'atajo', ruta, ...(motivo ? { prohibida: motivo } : {}) })
      }
    }
    for (const carpeta of this.deps.carpetasInicio) await recorrer(carpeta, 0)
    return lista
  }

  /** Resuelve el nombre que dio el modelo: coincidencia exacta, alias, prefijo único o fragmento único. */
  async resolver(nombre: string): Promise<Resolucion> {
    const motivoNombre = motivoNombreProhibido(nombre)
    if (motivoNombre) return { tipo: 'prohibida', motivo: motivoNombre }
    await this.cargar()
    let r = await this.buscar(nombre)
    if (r.tipo === 'ninguna' && this.ahora() - this.leidoEn > REFRESCO_MIN_MS) {
      await this.cargar(true)
      r = await this.buscar(nombre)
    }
    return r
  }

  private async buscar(nombre: string): Promise<Resolucion> {
    const n = normalizar(nombre)
    if (n === '') return { tipo: 'ninguna', sugerencias: [] }
    const abribles = this.entradas.filter((e) => !e.prohibida)

    const exacta = this.entradas.find((e) => e.clave === n)
    if (exacta) return exacta.prohibida ? { tipo: 'prohibida', motivo: exacta.prohibida } : { tipo: 'una', entrada: exacta }

    const destinoAlias = Object.entries(this.config.alias).find(([a]) => normalizar(a) === n)?.[1]
    if (destinoAlias !== undefined) return this.resolverAlias(destinoAlias)

    // La misma aplicación con el nombre en el otro idioma («calculadora» en un Windows en inglés).
    for (const sinonimo of SINONIMOS.find((g) => g.includes(n)) ?? []) {
      const e = sinonimo === n ? undefined : this.entradas.find((x) => x.clave === sinonimo)
      if (e) return e.prohibida ? { tipo: 'prohibida', motivo: e.prohibida } : { tipo: 'una', entrada: e }
    }

    if (n.length >= MIN_PARCIAL) {
      const porPrefijo = abribles.filter((e) => e.clave.startsWith(n))
      if (porPrefijo.length === 1) return { tipo: 'una', entrada: porPrefijo[0] }
      if (porPrefijo.length > 1) return { tipo: 'varias', candidatas: porPrefijo.slice(0, MAX_CANDIDATAS).map((e) => e.nombre) }
      const porFragmento = abribles.filter((e) => e.clave.includes(n))
      if (porFragmento.length === 1) return { tipo: 'una', entrada: porFragmento[0] }
      if (porFragmento.length > 1) return { tipo: 'varias', candidatas: porFragmento.slice(0, MAX_CANDIDATAS).map((e) => e.nombre) }
    }
    const palabras = n.split(' ').filter((p) => p.length >= MIN_PARCIAL)
    const parecidas = abribles.filter((e) => palabras.some((p) => e.clave.includes(p))).slice(0, MAX_CANDIDATAS)
    return { tipo: 'ninguna', sugerencias: parecidas.map((e) => e.nombre) }
  }

  /** Un alias apunta a una aplicación de la lista (por nombre) o, si es una ruta local, a un .exe o .lnk que exista. */
  private async resolverAlias(destino: string): Promise<Resolucion> {
    if (!esRutaLocalAbsoluta(destino)) {
      const motivo = motivoNombreProhibido(destino)
      if (motivo) return { tipo: 'prohibida', motivo }
      const n = normalizar(destino)
      const e = this.entradas.find((x) => x.clave === n)
      if (!e) return { tipo: 'ninguna', sugerencias: [] }
      return e.prohibida ? { tipo: 'prohibida', motivo: e.prohibida } : { tipo: 'una', entrada: e }
    }
    const extension = extname(destino).toLowerCase()
    if (extension !== '.exe' && extension !== '.lnk') {
      return { tipo: 'prohibida', motivo: 'El alias apunta a un archivo que no es un programa (.exe) ni un acceso directo (.lnk).' }
    }
    if (!(await this.deps.existeArchivo(destino))) return { tipo: 'ninguna', sugerencias: [] }
    let motivo: string | undefined
    if (extension === '.exe') motivo = motivoDestinoProhibido(destino)
    else {
      const atajo = this.leerAtajoSeguro(destino)
      motivo = atajo === null || atajo.destino === '' ? MOTIVO_SIN_DESTINO : motivoDestinoProhibido(atajo.destino, atajo.argumentos)
    }
    if (motivo) return { tipo: 'prohibida', motivo }
    const nombre = basename(destino, extension)
    return { tipo: 'una', entrada: { nombre, clave: normalizar(nombre), origen: 'ruta', ruta: destino } }
  }
}

// ---------------------------------------------------------------------------------------------
// aplicaciones.json
// ---------------------------------------------------------------------------------------------

const MAX_ALIAS = 200
const MAX_TEXTO_ALIAS = 260

/**
 * Lee el contenido de `aplicaciones.json`: `{ "alias": { "calculadora": "Calculadora" }, "excluir": ["Nombre"] }`. Lo que no
 * tenga la forma esperada se descarta, y si el archivo no es JSON se ignora entero. `avisos` cuenta qué se ignoró.
 */
export function leerConfigApps(texto: string): { config: ConfigApps; avisos: string[] } {
  const vacia: ConfigApps = { alias: {}, excluir: [] }
  const avisos: string[] = []
  let datos: unknown
  try {
    datos = JSON.parse(texto)
  } catch {
    return { config: vacia, avisos: ['aplicaciones.json no es un JSON válido; lo ignoro.'] }
  }
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) {
    return { config: vacia, avisos: ['aplicaciones.json debe ser un objeto con «alias» y «excluir»; lo ignoro.'] }
  }
  const bruto = datos as Record<string, unknown>
  const alias: Record<string, string> = {}
  if (bruto['alias'] !== undefined) {
    if (typeof bruto['alias'] !== 'object' || bruto['alias'] === null || Array.isArray(bruto['alias'])) {
      avisos.push('«alias» debe ser un objeto de nombre → aplicación o ruta; lo ignoro.')
    } else {
      for (const [clave, valor] of Object.entries(bruto['alias'])) {
        if (Object.keys(alias).length >= MAX_ALIAS) break
        if (typeof valor === 'string' && valor.trim() !== '' && valor.length <= MAX_TEXTO_ALIAS && normalizar(clave) !== '') alias[clave] = valor.trim()
        else avisos.push(`El alias «${clave}» no es válido; lo ignoro.`)
      }
    }
  }
  const excluir: string[] = []
  if (bruto['excluir'] !== undefined) {
    if (!Array.isArray(bruto['excluir'])) avisos.push('«excluir» debe ser una lista de nombres; la ignoro.')
    else for (const n of bruto['excluir'].slice(0, MAX_ALIAS)) if (typeof n === 'string' && n.trim() !== '') excluir.push(n.trim())
  }
  return { config: { alias, excluir }, avisos }
}

/** Pasa lo que escribió PowerShell (un objeto si hay una sola app, una lista si hay varias) a pares nombre-identificador. */
export function leerAppsTienda(salida: string): Array<{ nombre: string; appId: string }> {
  if (salida.trim() === '') return []
  const datos = JSON.parse(salida) as unknown
  const lista = Array.isArray(datos) ? datos : [datos]
  return lista.flatMap((d) => {
    if (typeof d !== 'object' || d === null) return []
    const { n, i } = d as Record<string, unknown>
    return typeof n === 'string' && typeof i === 'string' ? [{ nombre: n, appId: i }] : []
  })
}
