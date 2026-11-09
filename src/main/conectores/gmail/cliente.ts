/**
 * Cliente mínimo de la API de Gmail (https://developers.google.com/workspace/gmail/api/reference/rest): buscar, leer y
 * crear borradores. No hay ninguna función que envíe, borre o archive: ni existe aquí ni Orbe tiene ese permiso.
 */
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
export const TEXTO_MAX = 8000

export interface ResumenCorreo {
  id: string
  hilo: string
  de: string
  asunto: string
  fecha: string
  extracto: string
}

export interface Correo extends ResumenCorreo {
  para: string
  texto: string
}

export interface BorradorNuevo {
  para?: string
  asunto?: string
  cuerpo: string
  /** Id del correo al que se responde: el borrador queda en su mismo hilo. */
  responderA?: string
}

interface Parte {
  mimeType?: string
  filename?: string
  headers?: Array<{ name: string; value: string }>
  body?: { data?: string }
  parts?: Parte[]
}

interface Mensaje {
  id: string
  threadId: string
  snippet?: string
  payload?: Parte
}

const cabecera = (m: Mensaje, nombre: string): string => m.payload?.headers?.find((h) => h.name.toLowerCase() === nombre)?.value ?? ''

/** El texto de un correo: la parte `text/plain`; si solo hay HTML, sin etiquetas. Los adjuntos se ignoran. */
export function textoPlano(parte: Parte | undefined): string {
  const de = (tipo: string, p: Parte | undefined): string[] => {
    if (!p || p.filename) return []
    if (p.mimeType === tipo && p.body?.data) return [Buffer.from(p.body.data, 'base64url').toString('utf8')]
    return (p.parts ?? []).flatMap((h) => de(tipo, h))
  }
  const plano = de('text/plain', parte).join('\n').trim()
  return plano || quitarHtml(de('text/html', parte).join('\n'))
}

const ENTIDADES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }

// ponytail: limpieza de HTML por expresiones regulares, suficiente para leer un correo; si hiciera falta fidelidad
// (tablas, entidades raras), usar un parser de verdad.
export function quitarHtml(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|\/p|\/div|\/tr|\/h\d|\/li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (e) => ENTIDADES[e] ?? e)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim()
}

/** Una sola dirección (sola o como «Nombre <correo>»), sin saltos de línea: nada que permita colar otra cabecera. */
export function direccionValida(valor: string): boolean {
  if (/[\r\n,;]/.test(valor)) return false
  const correo = /<([^<>]+)>\s*$/.exec(valor)?.[1] ?? valor
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(correo.trim())
}

/** Cabecera con tildes o emojis, según RFC 2047 (si es ASCII simple, tal cual). */
function codificarCabecera(texto: string): string {
  const limpio = texto.replace(/[\r\n]+/g, ' ')
  return /^[\x20-\x7e]*$/.test(limpio) ? limpio : `=?UTF-8?B?${Buffer.from(limpio, 'utf8').toString('base64')}?=`
}

/** El correo en formato RFC 2822 y en base64url, que es como lo pide `drafts.create`. */
export function construirMime(c: { para: string; asunto: string; cuerpo: string; enRespuestaA?: string }): string {
  const lineas = [
    `To: ${c.para}`,
    `Subject: ${codificarCabecera(c.asunto)}`,
    ...(c.enRespuestaA ? [`In-Reply-To: ${c.enRespuestaA}`, `References: ${c.enRespuestaA}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(c.cuerpo, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n')
  ]
  return Buffer.from(lineas.join('\r\n'), 'utf8').toString('base64url')
}

export class Gmail {
  constructor(
    private readonly token: () => Promise<string>,
    private readonly pedir: typeof fetch = fetch
  ) {}

  private async llamar<T>(ruta: string, senal?: AbortSignal, cuerpo?: unknown): Promise<T> {
    const r = await this.pedir(API + ruta, {
      method: cuerpo === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
      signal: senal
    })
    if (r.ok) return (await r.json()) as T
    if (r.status === 401) throw new Error('Gmail rechazó el permiso: vuelve a conectar en Configuración → Conectores.')
    if (r.status === 403) throw new Error('Gmail no permite esa operación con los permisos de Orbe (solo leer y crear borradores).')
    if (r.status === 404) throw new Error('Ese correo no existe (el id no es válido o se borró).')
    if (r.status === 429) throw new Error('Gmail pide ir más despacio: espera un momento y vuelve a intentarlo.')
    throw new Error(`Gmail respondió con un error (${r.status}).`)
  }

  private resumen(m: Mensaje): ResumenCorreo {
    return { id: m.id, hilo: m.threadId, de: cabecera(m, 'from'), asunto: cabecera(m, 'subject'), fecha: cabecera(m, 'date'), extracto: m.snippet ?? '' }
  }

  /** Busca con la sintaxis del buscador de Gmail y devuelve remitente, asunto, fecha y extracto de cada correo. */
  async buscar(consulta: string, max: number, senal?: AbortSignal): Promise<ResumenCorreo[]> {
    const lista = await this.llamar<{ messages?: Array<{ id: string }> }>(`/messages?maxResults=${max}&q=${encodeURIComponent(consulta)}`, senal)
    const campos = 'format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date'
    const mensajes = await Promise.all((lista.messages ?? []).map((m) => this.llamar<Mensaje>(`/messages/${encodeURIComponent(m.id)}?${campos}`, senal)))
    return mensajes.map((m) => this.resumen(m))
  }

  /** Cabeceras y texto recortado: el HTML, las imágenes y los adjuntos no llegan al modelo. */
  async leer(id: string, senal?: AbortSignal): Promise<Correo> {
    const m = await this.llamar<Mensaje>(`/messages/${encodeURIComponent(id)}?format=full`, senal)
    const texto = textoPlano(m.payload)
    return { ...this.resumen(m), para: cabecera(m, 'to'), texto: texto.length > TEXTO_MAX ? `${texto.slice(0, TEXTO_MAX)}\n[…correo recortado]` : texto }
  }

  /** Crea un borrador (nunca envía). Devuelve su id; el usuario lo revisa y lo envía desde Gmail. */
  async crearBorrador(b: BorradorNuevo, senal?: AbortSignal): Promise<{ id: string; para: string; asunto: string }> {
    let para = b.para ?? ''
    let asunto = b.asunto ?? ''
    let hilo: string | undefined
    let enRespuestaA: string | undefined
    if (b.responderA) {
      const campos = 'format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID'
      const original = await this.llamar<Mensaje>(`/messages/${encodeURIComponent(b.responderA)}?${campos}`, senal)
      hilo = original.threadId
      enRespuestaA = cabecera(original, 'message-id').replace(/[\r\n]/g, '') || undefined
      para ||= cabecera(original, 'reply-to') || cabecera(original, 'from')
      const asuntoOriginal = cabecera(original, 'subject')
      asunto ||= /^re:/i.test(asuntoOriginal) ? asuntoOriginal : `Re: ${asuntoOriginal}`
    }
    if (!direccionValida(para)) throw new Error('Falta un destinatario válido (una sola dirección de correo).')
    if (!asunto.trim()) throw new Error('Falta el asunto.')
    const raw = construirMime({ para, asunto, cuerpo: b.cuerpo, enRespuestaA })
    const r = await this.llamar<{ id: string }>('/drafts', senal, { message: { raw, ...(hilo ? { threadId: hilo } : {}) } })
    return { id: r.id, para, asunto }
  }
}
