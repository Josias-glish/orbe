import { clasificarAccion, toolkitDe } from '../../conectores/composio/clasificar'
import type { ClienteComposio } from '../../conectores/composio/cliente'
import { definirHerramienta, type Herramienta } from '../tipos'
import { crearEsquema, crearValidador, recortar, type Campos } from '../validacion'

const MAX_TEXTO = 12_000
const NOMBRE_CLASE = {
  'composio.leer': 'leer (libre)',
  'composio.escribir': 'pide permiso'
} as const

const camposBuscar = {
  tarea: { tipo: 'texto', descripcion: 'Qué quieres hacer, en inglés y en una frase (p. ej. «list my Google Calendar events for tomorrow»).', max: 500 }
} as const satisfies Campos
const camposConectar = {
  app: { tipo: 'texto', descripcion: 'Slug de la app tal como sale en composio_buscar (p. ej. googlecalendar, notion, slack).', max: 60 }
} as const satisfies Campos
const camposEjecutar = {
  accion: { tipo: 'texto', descripcion: 'Slug exacto de la acción que dio composio_buscar (p. ej. NOTION_SEARCH_NOTION_PAGE). Nunca inventes uno.', max: 120 },
  argumentos: { tipo: 'texto', descripcion: 'Los argumentos como objeto JSON, según el esquema que dio composio_buscar. «{}» si no lleva.', max: 8000 }
} as const satisfies Campos

interface EntradaEjecutar {
  accion: string
  argumentos: string
}

const json = (v: unknown): string => recortar(typeof v === 'string' ? v : JSON.stringify(v, null, 1), MAX_TEXTO)
const esSlug = (s: string): boolean => /^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(s)

interface ResultadoBusqueda {
  data?: {
    results?: Array<{ primary_tool_slugs?: string[]; related_tool_slugs?: string[] }>
    tool_schemas?: Record<string, unknown>
    toolkit_connection_statuses?: Array<{ toolkit?: string; has_active_connection?: boolean }>
    session?: { id?: string }
  }
  error?: string | null
}

/** Valida la entrada de `composio_ejecutar`: slug en mayúsculas y argumentos que sean un objeto JSON. */
export function validarEjecutar(entrada: unknown): { ok: true; valor: EntradaEjecutar } | { ok: false; error: string } {
  const v = crearValidador<EntradaEjecutar>(camposEjecutar)(entrada)
  if (!v.ok) return v
  const accion = v.valor.accion.trim().toUpperCase()
  if (!esSlug(accion)) return { ok: false, error: 'La acción debe ser un slug de Composio (MAYÚSCULAS_CON_GUIONES_BAJOS).' }
  let args: unknown
  try {
    args = JSON.parse(v.valor.argumentos.trim() || '{}')
  } catch {
    return { ok: false, error: 'Los argumentos no son un JSON válido.' }
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return { ok: false, error: 'Los argumentos deben ser un objeto JSON.' }
  return { ok: true, valor: { accion, argumentos: JSON.stringify(args) } }
}

/**
 * Composio como un solo conector a cientos de apps. No se exponen sus siete meta-herramientas: Orbe ofrece estas tres,
 * y cada acción se clasifica por su nombre (`clasificar.ts`) para que `reglas.json` decida: leer es libre y todo lo
 * demás pide permiso en ese momento. Todo lo que devuelve Composio son datos de fuera.
 */
export function crearHerramientasComposio(cliente: ClienteComposio): Herramienta[] {
  let sesion: string | undefined
  return [
    definirHerramienta<{ tarea: string }>({
      nombre: 'composio_buscar',
      descripcion:
        'Busca en Composio (cientos de apps: Google Calendar, Notion, Slack, Trello, GitHub…) las acciones para una tarea. Devuelve los slugs, ' +
        'si la app está conectada, su esquema de argumentos y qué permiso necesita cada una en Orbe. Úsala antes de composio_ejecutar.',
      esquema: crearEsquema(camposBuscar),
      nivel: 'libre',
      accion: 'composio.leer',
      validar: crearValidador<{ tarea: string }>(camposBuscar),
      describir: (e) => `Buscando en Composio: ${recortar(e.tarea, 80)}`,
      async ejecutar(e, ctx) {
        const r = (await cliente.llamar(
          'COMPOSIO_SEARCH_TOOLS',
          { queries: [{ use_case: e.tarea }], session: sesion ? { id: sesion } : { generate_id: true } },
          ctx.senal
        )) as ResultadoBusqueda
        sesion = r.data?.session?.id ?? sesion
        const lineas: string[] = []
        if (r.error) lineas.push(`Aviso de Composio: ${r.error}`)
        const slugs = new Set<string>()
        for (const res of r.data?.results ?? []) for (const s of [...(res.primary_tool_slugs ?? []), ...(res.related_tool_slugs ?? [])]) slugs.add(s)
        if (slugs.size === 0) lineas.push('Composio no encontró acciones para esa tarea.')
        for (const s of slugs) lineas.push(`- ${s} · ${NOMBRE_CLASE[clasificarAccion(s)]}`)
        const estados = (r.data?.toolkit_connection_statuses ?? []).filter((t) => t.toolkit)
        if (estados.length) {
          lineas.push('', 'Conexiones:')
          for (const t of estados) lineas.push(`- ${t.toolkit}: ${t.has_active_connection ? 'conectada' : 'sin conectar (usa composio_conectar)'}`)
        }
        const esquemas = r.data?.tool_schemas ?? {}
        if (Object.keys(esquemas).length) lineas.push('', 'Esquemas:', json(esquemas))
        return { texto: lineas.join('\n'), externo: { origen: 'Composio' } }
      }
    }),
    definirHerramienta<{ app: string }>({
      nombre: 'composio_conectar',
      descripcion:
        'Pide a Composio el enlace para que el usuario conecte una app con su cuenta (OAuth en su navegador). Enséñale el enlace en ' +
        'markdown; la conexión la aprueba él.',
      esquema: crearEsquema(camposConectar),
      nivel: 'libre',
      accion: 'composio.leer',
      validar: crearValidador<{ app: string }>(camposConectar),
      describir: (e) => `Preparando la conexión con ${e.app}`,
      async ejecutar(e, ctx) {
        const app = e.app.trim().toLowerCase()
        if (!/^[a-z0-9_]+$/.test(app)) return { texto: 'Ese no es un slug de app de Composio.' }
        const r = await cliente.llamar('COMPOSIO_MANAGE_CONNECTIONS', { toolkits: [app], ...(sesion ? { session_id: sesion } : {}) }, ctx.senal)
        const enlaces = [...new Set(JSON.stringify(r).match(/https:\/\/[^\s"'\\)]+/g) ?? [])].filter((u) => !u.includes('/docs'))
        const texto = enlaces.length
          ? `Enlace para conectar ${app} (caduca pronto): ${enlaces[0]}`
          : `Composio respondió sin enlace; puede que ${app} ya esté conectada.\n${json(r)}`
        return { texto, externo: { origen: 'Composio' } }
      }
    }),
    definirHerramienta<EntradaEjecutar>({
      nombre: 'composio_ejecutar',
      descripcion:
        'Ejecuta UNA acción de Composio con el slug exacto que dio composio_buscar y sus argumentos en JSON. Leer es libre; todo lo demás ' +
        '(crear, enviar, publicar, borrar…) pide permiso al usuario en ese momento.',
      esquema: crearEsquema(camposEjecutar),
      nivel: 'confirmar',
      // El permiso depende de la acción concreta: lo decide `reglas.json` con la clase de su nombre.
      accion: 'composio.escribir',
      accionDe: (e) => clasificarAccion(String((e as Partial<EntradaEjecutar>).accion ?? '')),
      validar: validarEjecutar,
      describir: (e) => `Composio · ${e.accion} (${toolkitDe(e.accion)})`,
      async ejecutar(e, ctx) {
        const r = (await cliente.llamar(
          'COMPOSIO_MULTI_EXECUTE_TOOL',
          {
            tools: [{ tool_slug: e.accion, arguments: JSON.parse(e.argumentos) as Record<string, unknown> }],
            sync_response_to_workbench: false,
            ...(sesion ? { session_id: sesion } : {})
          },
          ctx.senal
        )) as { data?: { results?: Array<{ response?: unknown; error?: string }> }; error?: string; successful?: boolean }
        const res = r.data?.results?.[0]
        if (res?.error || r.successful === false) return { texto: `La acción falló: ${res?.error ?? r.error ?? 'sin detalle'}`, externo: { origen: 'Composio' } }
        return { texto: json(res?.response ?? r), externo: { origen: 'Composio' } }
      }
    })
  ]
}
