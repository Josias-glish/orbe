/**
 * Cliente de SOLO LECTURA de la API de Instagram con inicio de sesión de Instagram
 * (https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login): perfil, publicaciones,
 * métricas y comentarios de las cuentas propias. Aquí no hay ninguna función que publique, responda, siga o borre:
 * publicar llega en la Etapa 4 y siempre con aprobación.
 */

/** Versión de la API. Meta retira versiones con el tiempo: https://developers.facebook.com/docs/graph-api/changelog */
export const VERSION_API = 'v27.0'
const BASE = `https://graph.instagram.com/${VERSION_API}`
const RENOVAR = 'https://graph.instagram.com/refresh_access_token'
const DIA = 86_400_000
/** Un token dura 60 días y se puede renovar si tiene más de 24 h: lo renovamos a los 30. */
const DIAS_PARA_RENOVAR = 30
const PIE_MAX = 300

/** Los nombres internos de las cuentas: el token de cada una se guarda en el cofre como `ig.<cuenta>`. */
export const CUENTAS = ['jsdesign', 'morfy', 'personal'] as const
export type Cuenta = (typeof CUENTAS)[number]
export const NOMBRE_CUENTA: Readonly<Record<Cuenta, string>> = { jsdesign: 'J&S Design', morfy: 'morfy', personal: 'tu marca personal' }

/** Como guarda el cofre un token de Instagram (`forma: 'token_ig'`). */
export interface TokenGuardado {
  token: string
  renovado: string
}

export interface Perfil {
  usuario: string
  nombre: string
  tipo: string
  seguidores: number
  seguidos: number
  publicaciones: number
}

export interface Publicacion {
  id: string
  pie: string
  tipo: string
  enlace: string
  fecha: string
  meGusta: number
  comentarios: number
}

/** Las métricas que valen tanto para publicaciones (FEED) como para reels, según la referencia de Meta. */
export const METRICAS = ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions'] as const
export type Metricas = Partial<Record<(typeof METRICAS)[number], number>>

export interface Comentario {
  id: string
  usuario: string
  texto: string
  fecha: string
}

/** El error de Meta, traducido. Nunca lleva el token: solo el código y un texto nuestro. */
function errorDeMeta(codigo: number | undefined, status: number): Error {
  if (codigo === 190) return new Error('El token de Instagram caducó o se revocó: genera uno nuevo en Meta Developers y guárdalo en Configuración → Conectores.')
  if (codigo === 4 || codigo === 17 || codigo === 32 || codigo === 613) return new Error('Instagram pide ir más despacio (límite de peticiones): espera unos minutos.')
  if (codigo === 10 || codigo === 200) return new Error('A la app de Meta le falta ese permiso para esta cuenta (revisa los permisos de la guía 01, paso 2).')
  if (codigo === 100) return new Error('Instagram no reconoce esa petición (el id no existe o ese dato no está disponible para esa publicación).')
  return new Error(`Instagram respondió con un error (${codigo ? `código ${codigo}` : status}).`)
}

export class Instagram {
  constructor(
    private readonly token: () => Promise<string>,
    private readonly pedir: typeof fetch = fetch
  ) {}

  private async llamar<T>(ruta: string, params: Record<string, string>, senal?: AbortSignal): Promise<T> {
    const r = await this.pedir(`${BASE}${ruta}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${await this.token()}` },
      signal: senal
    })
    const j = (await r.json().catch(() => ({}))) as T & { error?: { code?: number } }
    if (!r.ok || j.error) throw errorDeMeta(j.error?.code, r.status)
    return j
  }

  async perfil(senal?: AbortSignal): Promise<Perfil> {
    const p = await this.llamar<{ username?: string; name?: string; account_type?: string; followers_count?: number; follows_count?: number; media_count?: number }>(
      '/me',
      { fields: 'user_id,username,name,account_type,followers_count,follows_count,media_count' },
      senal
    )
    return {
      usuario: p.username ?? '',
      nombre: p.name ?? '',
      tipo: p.account_type ?? '',
      seguidores: p.followers_count ?? 0,
      seguidos: p.follows_count ?? 0,
      publicaciones: p.media_count ?? 0
    }
  }

  /** Las últimas publicaciones, de la más reciente a la más antigua. El pie de foto llega recortado. */
  async publicaciones(max: number, senal?: AbortSignal): Promise<Publicacion[]> {
    const j = await this.llamar<{
      data?: Array<{ id: string; caption?: string; media_type?: string; media_product_type?: string; permalink?: string; timestamp?: string; like_count?: number; comments_count?: number }>
    }>('/me/media', { fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count', limit: String(max) }, senal)
    return (j.data ?? []).map((m) => ({
      id: m.id,
      pie: (m.caption ?? '').length > PIE_MAX ? `${(m.caption ?? '').slice(0, PIE_MAX)}…` : (m.caption ?? ''),
      tipo: m.media_product_type === 'REELS' ? 'reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'carrusel' : m.media_type === 'VIDEO' ? 'vídeo' : 'imagen',
      enlace: m.permalink ?? '',
      fecha: m.timestamp ?? '',
      meGusta: m.like_count ?? 0,
      comentarios: m.comments_count ?? 0
    }))
  }

  /** Métricas de una publicación. Meta puede tardar hasta 48 h en tenerlas y devuelve vacío en vez de 0. */
  async metricas(id: string, senal?: AbortSignal): Promise<Metricas> {
    const j = await this.llamar<{ data?: Array<{ name: string; values?: Array<{ value?: number }> }> }>(`/${encodeURIComponent(id)}/insights`, { metric: METRICAS.join(',') }, senal)
    return Object.fromEntries((j.data ?? []).map((m) => [m.name, m.values?.[0]?.value ?? 0]))
  }

  async comentarios(id: string, max: number, senal?: AbortSignal): Promise<Comentario[]> {
    const j = await this.llamar<{ data?: Array<{ id: string; text?: string; username?: string; timestamp?: string }> }>(
      `/${encodeURIComponent(id)}/comments`,
      { fields: 'id,text,username,timestamp', limit: String(max) },
      senal
    )
    return (j.data ?? []).map((c) => ({ id: c.id, usuario: c.username ?? '', texto: c.text ?? '', fecha: c.timestamp ?? '' }))
  }
}

/**
 * Da el token de una cuenta desde el cofre y lo renueva solo cuando lleva 30 días guardado (Meta lo alarga 60 más).
 * Si la renovación falla (sin conexión, Meta caído) sigue con el que hay: aún vale, y si ya caducó la propia petición
 * dirá que hay que generar otro. La dirección de renovación lleva el token (así lo pide Meta) y nunca se registra.
 */
export function crearFuenteTokenIg(
  leer: (clave: string) => TokenGuardado | undefined,
  guardar: (clave: string, valor: TokenGuardado) => void,
  pedir: typeof fetch = fetch,
  ahora: () => number = Date.now
): (cuenta: Cuenta) => Promise<string> {
  return async (cuenta) => {
    const g = leer(`ig.${cuenta}`)
    if (!g?.token) throw new Error(`Instagram de ${NOMBRE_CUENTA[cuenta]} no está conectado: guarda su token en Configuración → Conectores → Instagram.`)
    // Los tokens del «inicio de sesión de Facebook» (Explorador de la API Graph) empiezan por EAA y graph.instagram.com
    // los rechaza con un 190 que parece un token caducado: mejor decir cuál es el problema de verdad.
    if (g.token.startsWith('EAA')) {
      throw new Error(
        `El token guardado para ${NOMBRE_CUENTA[cuenta]} es de Facebook (empieza por EAA) y no sirve aquí. Genera el de Instagram en Meta Developers → ` +
          'tu app → Instagram → Configuración de la API con inicio de sesión de Instagram → Generar identificadores de acceso, y guárdalo en Configuración → Conectores.'
      )
    }
    if (ahora() - Date.parse(g.renovado) < DIAS_PARA_RENOVAR * DIA) return g.token
    try {
      const r = await pedir(`${RENOVAR}?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: g.token })}`)
      const j = (await r.json().catch(() => ({}))) as { access_token?: string }
      if (!j.access_token) return g.token
      guardar(`ig.${cuenta}`, { token: j.access_token, renovado: new Date(ahora()).toISOString() })
      return j.access_token
    } catch {
      return g.token
    }
  }
}
