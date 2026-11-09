# Código (borrador)

> Borrador para revisión: **no está en `src/` ni se compila todavía**. Sigue la arquitectura actual de Orbe:
> proceso principal de Electron (`src/main`), herramientas del agente (`definirHerramienta`, `Politica`) que el CLI usa
> por el servidor MCP local de Orbe (`mcp__orbe__*`), y contenido externo envuelto como datos (`envolverExterno`).
> En la Fase 4 cada módulo llevará sus pruebas (vitest) antes de entrar.

Archivos nuevos previstos:

```
src/main/cofre/cofre.ts              §1  secretos cifrados (safeStorage)
src/main/agente/reglas.ts            §2  reglas en 4 niveles + bloqueos fijos
src/main/conectores/gmail/oauth.ts   §3  OAuth de escritorio (loopback + PKCE)
src/main/conectores/gmail/cliente.ts §3  leer, buscar, historial, borradores
src/main/conectores/instagram.ts     §4  perfil, publicaciones, métricas, comentarios, publicar
src/main/conectores/supabase.ts      §5  subir, enlace firmado, borrar
src/main/contenido/disenador.ts      §6  Claude CLI + Claude Design → HTML
src/main/contenido/render.ts         §6  HTML → PNG (ventana oculta, sin red)
src/main/contenido/publicador.ts     §6  aprobación → Supabase → Meta → limpieza
src/main/agente/herramientas/*.ts    §7  herramientas MCP nuevas
src/main/agente/revisor.ts           §8  segunda opinión antes de acciones de riesgo
src/main/navegador/*.ts              §9  navegador propio (Playwright + Edge)
src/main/conectores/vigilante.ts     §10 activadores por sondeo
```

---

## §1 Cofre de secretos

```ts
// src/main/cofre/cofre.ts
import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'

type Secretos = Record<string, unknown>

/** Secretos cifrados con DPAPI (Windows). Nunca pasan al renderer, a los registros ni al modelo. */
export class Cofre {
  private datos: Secretos | null = null
  constructor(private readonly ruta: string) {}

  private cargar(): Secretos {
    if (this.datos) return this.datos
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado de Windows no está disponible.')
    this.datos = existsSync(this.ruta)
      ? (JSON.parse(safeStorage.decryptString(readFileSync(this.ruta))).secretos as Secretos)
      : {}
    return this.datos
  }

  leer<T = string>(clave: string): T | undefined {
    return this.cargar()[clave] as T | undefined
  }

  guardar(clave: string, valor: unknown): void {
    this.escribir({ ...this.cargar(), [clave]: valor })
  }

  borrar(clave: string): void {
    const { [clave]: _fuera, ...resto } = this.cargar()
    this.escribir(resto)
  }

  private escribir(datos: Secretos): void {
    const cifrado = safeStorage.encryptString(JSON.stringify({ version: 1, secretos: datos }))
    writeFileSync(this.ruta + '.tmp', cifrado, { mode: 0o600 })
    renameSync(this.ruta + '.tmp', this.ruta) // escritura atómica
    this.datos = datos
  }

  /** Para la interfaz: solo qué hay guardado, nunca el valor. */
  estado(): Record<string, boolean> {
    return Object.fromEntries(Object.keys(this.cargar()).map((k) => [k, true]))
  }
}
```

IPC: `cofreGuardar(clave, valor)` desde Ajustes (el valor viaja una sola vez del campo de texto al proceso principal y el
campo se vacía); `cofreEstado()` devuelve solo booleanos. No hay ningún canal para **leer** un secreto desde la interfaz.

---

## §2 Reglas en cuatro niveles

```ts
// src/main/agente/reglas.ts
export type Modo = 'libre' | 'si_lo_pediste' | 'preguntar' | 'tu_lo_haces' | 'bloqueado'

/** Acciones que ningún archivo de reglas puede relajar por debajo de este mínimo. */
const MINIMO: Record<string, Modo> = {
  'ig.publicar': 'preguntar',
  'ig.responder_mensaje': 'preguntar',
  'navegador.comprar': 'bloqueado',
  'navegador.contrasena': 'bloqueado'
}
const ORDEN: Modo[] = ['libre', 'si_lo_pediste', 'preguntar', 'tu_lo_haces', 'bloqueado']

export function modoDe(accion: string, reglas: Record<string, Modo>): Modo {
  const elegido = reglas[accion] ?? 'preguntar'               // lo desconocido, se pregunta
  const minimo = MINIMO[accion] ?? 'libre'
  return ORDEN.indexOf(elegido) >= ORDEN.indexOf(minimo) ? elegido : minimo
}

/**
 * «si_lo_pediste»: solo vale si la orden del usuario (no el texto de un correo o una web) nombra la acción.
 * Se decide con la orden original de la tarea, que el modelo no puede reescribir.
 */
export function pedidoExplicito(accion: string, ordenUsuario: string): boolean {
  const pistas: Record<string, RegExp> = {
    'gmail.borrador': /\b(borrador|responde|contesta|redacta)\b/i,
    'ig.responder_comentario': /\b(responde|contesta)\b.*\bcomentario/i
  }
  return pistas[accion]?.test(ordenUsuario) ?? false
}
```

Integración: cada herramienta nueva declara su `accion` (p. ej. `ig.publicar`) y `clasificar()` devuelve
`permitir` / `confirmar` / `prohibir` según `modoDe`. `tu_lo_haces` se traduce en `prohibir` con el motivo «Te lo dejo
preparado: hazlo tú desde…».

---

## §3 Gmail

### OAuth de escritorio (loopback + PKCE)

```ts
// src/main/conectores/gmail/oauth.ts
import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { shell } from 'electron'

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
const PERMISOS = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose']

interface Cliente { client_id: string; client_secret: string }

/** Abre el navegador, espera la vuelta en 127.0.0.1 y devuelve el refresh token (que va directo al cofre). */
export async function conectarGmail(cliente: Cliente): Promise<string> {
  const verificador = randomBytes(32).toString('base64url')
  const reto = createHash('sha256').update(verificador).digest('base64url')
  const estado = randomBytes(16).toString('hex')

  const { codigo, redirect } = await new Promise<{ codigo: string; redirect: string }>((resolver, rechazar) => {
    const servidor = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.searchParams.get('state') !== estado) { res.end('Estado inválido.'); return }
      const codigo = url.searchParams.get('code')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end('<p>Listo. Ya puedes volver a Orbe.</p>')
      servidor.close()
      codigo ? resolver({ codigo, redirect }) : rechazar(new Error(url.searchParams.get('error') ?? 'Cancelado.'))
    })
    let redirect = ''
    servidor.listen(0, '127.0.0.1', () => {
      const puerto = (servidor.address() as { port: number }).port
      redirect = `http://127.0.0.1:${puerto}`
      const p = new URLSearchParams({
        client_id: cliente.client_id, redirect_uri: redirect, response_type: 'code',
        scope: PERMISOS.join(' '), access_type: 'offline', prompt: 'consent',
        code_challenge: reto, code_challenge_method: 'S256', state: estado
      })
      void shell.openExternal(`${AUTH}?${p}`)
    })
    setTimeout(() => { servidor.close(); rechazar(new Error('Tiempo agotado (5 min).')) }, 5 * 60_000)
  })

  const r = await fetch(TOKEN, {
    method: 'POST',
    body: new URLSearchParams({
      code: codigo, client_id: cliente.client_id, client_secret: cliente.client_secret,
      redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verificador
    })
  })
  const j = (await r.json()) as { refresh_token?: string; error?: string }
  if (!j.refresh_token) throw new Error(`Google no devolvió permiso: ${j.error ?? r.status}`)
  return j.refresh_token
}

export async function tokenDeAcceso(cliente: Cliente, refresh: string): Promise<string> {
  const r = await fetch(TOKEN, {
    method: 'POST',
    body: new URLSearchParams({ client_id: cliente.client_id, client_secret: cliente.client_secret, refresh_token: refresh, grant_type: 'refresh_token' })
  })
  const j = (await r.json()) as { access_token?: string; error?: string }
  if (!j.access_token) throw new Error(j.error === 'invalid_grant' ? 'El permiso de Gmail caducó: vuelve a conectar.' : `Error de Google (${r.status}).`)
  return j.access_token
}
```

### Cliente

```ts
// src/main/conectores/gmail/cliente.ts
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export class Gmail {
  constructor(private readonly token: () => Promise<string>) {}

  private async get<T>(ruta: string): Promise<T> {
    const r = await fetch(API + ruta, { headers: { Authorization: `Bearer ${await this.token()}` } })
    if (!r.ok) throw new Error(`Gmail ${r.status}`)
    return r.json() as Promise<T>
  }

  buscar(q: string, max = 10) {
    return this.get<{ messages?: Array<{ id: string }> }>(`/messages?maxResults=${max}&q=${encodeURIComponent(q)}`)
  }

  /** Solo cabeceras y texto plano, recortado: el HTML de los correos no llega al modelo. */
  async leer(id: string): Promise<{ de: string; asunto: string; fecha: string; texto: string }> {
    const m = await this.get<any>(`/messages/${id}?format=full`)
    const cab = (n: string) => m.payload.headers.find((h: any) => h.name.toLowerCase() === n)?.value ?? ''
    return { de: cab('from'), asunto: cab('subject'), fecha: cab('date'), texto: textoPlano(m.payload).slice(0, 8000) }
  }

  /** Correos nuevos desde la última vez (para el vigilante). */
  cambios(desde: string) {
    return this.get<{ history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>; historyId: string }>(
      `/history?startHistoryId=${desde}&historyTypes=messageAdded`
    )
  }

  async crearBorrador(para: string, asunto: string, cuerpo: string, enRespuestaA?: string): Promise<string> {
    const mime = [`To: ${para}`, `Subject: ${asunto}`, 'Content-Type: text/plain; charset=UTF-8', '', cuerpo].join('\r\n')
    const r = await fetch(`${API}/drafts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: Buffer.from(mime).toString('base64url'), ...(enRespuestaA ? { threadId: enRespuestaA } : {}) } })
    })
    if (!r.ok) throw new Error(`No se pudo crear el borrador (${r.status}).`)
    return ((await r.json()) as { id: string }).id
  }
}

function textoPlano(parte: any): string {
  if (parte.mimeType === 'text/plain' && parte.body?.data) return Buffer.from(parte.body.data, 'base64url').toString('utf8')
  return (parte.parts ?? []).map(textoPlano).join('\n')
}
```

(Los asuntos con tildes se codificarán en la Fase 4 con `=?UTF-8?B?…?=`.)

---

## §4 Instagram

```ts
// src/main/conectores/instagram.ts
export interface Metricas { views?: number; reach?: number; likes?: number; comments?: number; shares?: number; saved?: number; total_interactions?: number }

export class Instagram {
  private readonly base: string
  constructor(private readonly token: () => string, version: string, private readonly maxDia: number) {
    this.base = `https://graph.instagram.com/${version}`
  }

  private async pedir<T>(ruta: string, metodo: 'GET' | 'POST' = 'GET', params: Record<string, string> = {}): Promise<T> {
    const p = new URLSearchParams(params)
    const url = `${this.base}${ruta}${metodo === 'GET' ? `?${p}` : ''}`
    const r = await fetch(url, {
      method: metodo,
      headers: { Authorization: `Bearer ${this.token()}` },
      ...(metodo === 'POST' ? { body: p } : {})
    })
    const j = (await r.json()) as T & { error?: { message: string; code: number } }
    if (!r.ok || j.error) throw new Error(`Instagram: ${j.error?.message ?? r.status}`)
    return j
  }

  perfil() {
    return this.pedir<{ user_id: string; username: string; account_type: string; followers_count: number }>(
      '/me', 'GET', { fields: 'user_id,username,account_type,followers_count,media_count' })
  }

  publicaciones(limite = 25) {
    return this.pedir<{ data: Array<{ id: string; caption?: string; media_type: string; permalink: string; timestamp: string; like_count?: number; comments_count?: number }> }>(
      '/me/media', 'GET', { fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count', limit: String(limite) })
  }

  async metricas(mediaId: string): Promise<Metricas> {
    const j = await this.pedir<{ data: Array<{ name: string; values: Array<{ value: number }> }> }>(
      `/${mediaId}/insights`, 'GET', { metric: 'views,reach,likes,comments,shares,saved,total_interactions' })
    return Object.fromEntries(j.data.map((m) => [m.name, m.values[0]?.value ?? 0]))
  }

  comentarios(mediaId: string) {
    return this.pedir<{ data: Array<{ id: string; text: string; username: string; timestamp: string }> }>(
      `/${mediaId}/comments`, 'GET', { fields: 'id,text,username,timestamp' })
  }

  responderComentario(comentarioId: string, texto: string) {
    return this.pedir<{ id: string }>(`/${comentarioId}/replies`, 'POST', { message: texto })
  }

  /** Cuánto queda del límite de Meta; además aplicamos el nuestro (ORBE_IG_MAX_DIA). */
  async cupo(igId: string): Promise<number> {
    const j = await this.pedir<{ data: Array<{ quota_usage: number }> }>(`/${igId}/content_publishing_limit`, 'GET', { fields: 'quota_usage' })
    return this.maxDia - (j.data[0]?.quota_usage ?? 0)
  }

  /** Publica una imagen (o carrusel) a partir de URLs firmadas. Solo lo llama el publicador tras tu aprobación. */
  async publicar(igId: string, urls: string[], pie: string): Promise<{ id: string; permalink: string }> {
    if ((await this.cupo(igId)) <= 0) throw new Error('Límite diario de publicaciones alcanzado.')
    let contenedor: string
    if (urls.length === 1) {
      contenedor = (await this.pedir<{ id: string }>(`/${igId}/media`, 'POST', { image_url: urls[0], caption: pie })).id
    } else {
      const hijos: string[] = []
      for (const u of urls) hijos.push((await this.pedir<{ id: string }>(`/${igId}/media`, 'POST', { image_url: u, is_carousel_item: 'true' })).id)
      contenedor = (await this.pedir<{ id: string }>(`/${igId}/media`, 'POST', { media_type: 'CAROUSEL', children: hijos.join(','), caption: pie })).id
    }
    await this.esperarListo(contenedor)
    const { id } = await this.pedir<{ id: string }>(`/${igId}/media_publish`, 'POST', { creation_id: contenedor })
    const { permalink } = await this.pedir<{ permalink: string }>(`/${id}`, 'GET', { fields: 'permalink' })
    return { id, permalink }
  }

  private async esperarListo(contenedor: string): Promise<void> {
    for (let i = 0; i < 30; i++) {
      const { status_code } = await this.pedir<{ status_code: string }>(`/${contenedor}`, 'GET', { fields: 'status_code' })
      if (status_code === 'FINISHED') return
      if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`Meta rechazó el archivo (${status_code}).`)
      await new Promise((r) => setTimeout(r, 5000))
    }
    throw new Error('Meta tardó demasiado en procesar el archivo.')
  }
}

/** Renovación del token de larga duración (cada 30 días; debe tener al menos 24 h). */
export async function renovarToken(token: string): Promise<string> {
  const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`)
  const j = (await r.json()) as { access_token?: string }
  if (!j.access_token) throw new Error('No se pudo renovar el token de Instagram: genera uno nuevo en Meta Developers.')
  return j.access_token
}
```

Notas: `renovarToken` lleva el token en la URL porque así lo pide Meta; esa URL nunca se registra. Los reels
(`media_type=REELS`, `video_url`) se añaden igual que las imágenes cuando los necesites.

---

## §5 Supabase Storage

```ts
// src/main/conectores/supabase.ts
import { randomUUID } from 'node:crypto'

export class Medios {
  constructor(private readonly url: string, private readonly bucket: string, private readonly clave: () => string) {}

  private cab(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.clave()}`, apikey: this.clave(), ...extra }
  }

  /** Sube con un nombre aleatorio (nada de nombres de cliente o marca en la ruta). */
  async subir(datos: Buffer, tipo: 'image/png' | 'image/jpeg' | 'video/mp4'): Promise<string> {
    const ruta = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${tipo.split('/')[1]}`
    const r = await fetch(`${this.url}/storage/v1/object/${this.bucket}/${ruta}`, {
      method: 'POST', headers: this.cab({ 'Content-Type': tipo, 'x-upsert': 'false' }), body: datos
    })
    if (!r.ok) throw new Error(`Supabase no aceptó el archivo (${r.status}).`)
    return ruta
  }

  async enlaceFirmado(ruta: string, minutos: number): Promise<string> {
    const r = await fetch(`${this.url}/storage/v1/object/sign/${this.bucket}/${ruta}`, {
      method: 'POST', headers: this.cab({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: minutos * 60 })
    })
    const j = (await r.json()) as { signedURL?: string }
    if (!j.signedURL) throw new Error('Supabase no dio enlace firmado.')
    return `${this.url}/storage/v1${j.signedURL}`
  }

  async borrar(rutas: string[]): Promise<void> {
    await fetch(`${this.url}/storage/v1/object/${this.bucket}`, {
      method: 'DELETE', headers: this.cab({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: rutas })
    })
  }
}
```

---

## §6 Contenido: Claude CLI + Claude Design → PNG → publicación

### Diseñador (CLI, sin API)

```ts
// src/main/contenido/disenador.ts
import { spawn } from 'node:child_process'
import { join } from 'node:path'

export interface PeticionDiseno { marca: string; idea: string; pie: string; formato: 'imagen' | 'carrusel'; diapositivas?: number }

/**
 * Lanza `claude -p` con: solo lectura de la carpeta de la marca (export de Claude Design) y una única herramienta
 * de escritura (`contenido_guardar_diseno`, servidor MCP de Orbe). Sin consola, sin web, sin ajustes del usuario.
 * Reutiliza buscarRutaCli(), la limpieza de ANTHROPIC_API_KEY y el lector stream-json de proveedor-cli.ts.
 */
export function argumentosDisenador(carpetaMarca: string, modelo: string, configMcp: string, prompt: string): string[] {
  return [
    '-p', '--output-format', 'stream-json', '--verbose',
    '--model', modelo,
    '--tools', 'Read,Glob',
    '--add-dir', carpetaMarca,
    '--setting-sources', '',
    '--strict-mcp-config', '--mcp-config', configMcp,
    '--allowedTools', 'Read,Glob,mcp__orbe__contenido_guardar_diseno',
    '--permission-mode', 'dontAsk',
    '--system-prompt', prompt
  ]
}

export function carpetaDeMarca(datos: string, marca: string): string {
  if (!/^[a-z0-9-]{1,40}$/.test(marca)) throw new Error('Marca no válida.')
  return join(datos, 'contenido', 'marcas', marca, 'design')
}
```

### Render HTML → PNG (sin red y sin JavaScript)

```ts
// src/main/contenido/render.ts
import { BrowserWindow, session } from 'electron'

const ANCHO = 1080, ALTO = 1350

export async function renderizarPng(html: string, carpetaMarca: string): Promise<Buffer> {
  const ses = session.fromPartition('orbe-render') // sesión aislada, sin cookies tuyas
  // Solo archivos locales de la carpeta de la marca (fuentes, logo) y data: URIs. Nada de internet.
  ses.webRequest.onBeforeRequest((d, cb) => {
    const ok = d.url.startsWith('data:') || d.url.startsWith('file:///' + carpetaMarca.replace(/\\/g, '/'))
    cb({ cancel: !ok })
  })
  const win = new BrowserWindow({
    show: false, width: ANCHO, height: ALTO, useContentSize: true,
    webPreferences: { session: ses, javascript: false, sandbox: true, offscreen: true, contextIsolation: true }
  })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise((r) => setTimeout(r, 300)) // fuentes
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: ANCHO, height: ALTO })
    return img.resize({ width: ANCHO, height: ALTO }).toPNG()
  } finally {
    win.destroy()
  }
}
```

### Publicador (el único camino hacia Instagram)

```ts
// src/main/contenido/publicador.ts
export async function publicarPieza(pieza: Pieza, deps: { medios: Medios; ig: Instagram; igId: string; minutos: number; leer(ruta: string): Buffer }) {
  if (!pieza.aprobada_por_ti) throw new Error('Sin tu aprobación no se publica.')       // doble cierre
  const rutas: string[] = []
  try {
    for (const a of pieza.archivos) rutas.push(await deps.medios.subir(deps.leer(a), 'image/png'))
    const urls = await Promise.all(rutas.map((r) => deps.medios.enlaceFirmado(r, deps.minutos)))
    const pie = [pieza.pie, pieza.hashtags.join(' ')].filter(Boolean).join('\n\n')
    return await deps.ig.publicar(deps.igId, urls, pie)
  } finally {
    await deps.medios.borrar(rutas).catch(() => undefined) // se borra siempre, haya ido bien o mal
  }
}
```

La aprobación se pide con la ventana de permisos que ya usan las Tareas, **mostrando la imagen final y el texto exacto**.
Si la tarea se ejecuta con retraso (portátil apagado a la hora programada), vuelve a preguntar: nunca publica tarde
sin avisar.

---

## §7 Herramientas MCP nuevas (lo que Claude puede usar)

Ejemplo completo de una; las demás siguen el mismo molde.

```ts
// src/main/agente/herramientas/ig-metricas.ts
import { definirHerramienta } from '../tipos'
import { crearEsquema, crearValidador, type Campos } from '../validacion'

const campos = {
  cuenta: { tipo: 'opcion', descripcion: 'Cuenta de Instagram.', valores: ['jsdesign', 'morfy'] },
  dias: { tipo: 'entero', descripcion: 'Días hacia atrás (1–90).', min: 1, max: 90 }
} as const satisfies Campos

export const crearIgMetricas = (ig: (cuenta: string) => Instagram) =>
  definirHerramienta<{ cuenta: string; dias: number }>({
    nombre: 'ig_metricas',
    descripcion: 'Métricas de las publicaciones recientes de una cuenta (views, alcance, interacciones, guardados, compartidos).',
    esquema: crearEsquema(campos),
    nivel: 'libre',
    validar: crearValidador(campos),
    describir: (e) => `Mirando métricas de ${e.cuenta} (${e.dias} días)`,
    async ejecutar(e) {
      const cliente = ig(e.cuenta)
      const desde = Date.now() - e.dias * 86_400_000
      const pubs = (await cliente.publicaciones(50)).data.filter((p) => Date.parse(p.timestamp) >= desde)
      const filas = await Promise.all(pubs.map(async (p) => ({ ...p, ...(await cliente.metricas(p.id)) })))
      // Los pies de foto y comentarios son contenido externo: van envueltos como datos.
      return { texto: JSON.stringify(filas), externo: { origen: 'Instagram' } }
    }
  })
```

| Herramienta | Acción (reglas) | Por defecto |
|---|---|---|
| `gmail_buscar`, `gmail_leer` | `gmail.leer` | libre |
| `gmail_borrador` | `gmail.borrador` | si lo pediste |
| `ig_perfil`, `ig_publicaciones`, `ig_metricas`, `ig_comentarios` | `ig.leer` | libre |
| `ig_responder_comentario` | `ig.responder_comentario` | preguntar |
| `contenido_proponer` (idea + pie + hashtags → «Contenido») | — | libre (solo guarda en local) |
| `contenido_guardar_diseno` (HTML → render) | — | libre (solo guarda en local) |
| `contenido_programar` (pide publicar en fecha) | `ig.publicar` | preguntar, con vista previa |
| `navegador_*` | ver §9 | ver §9 |

No existe ninguna herramienta que publique directamente: `contenido_programar` solo crea la petición; la publicación
la hace el publicador (§6) tras tu «Sí».

---

## §8 Revisor (segunda opinión barata)

Antes de mostrarte una petición de aprobación de riesgo (`ig.publicar`, `ig.responder_*`, `navegador.enviar`), Orbe
lanza un `claude -p --model haiku --tools ""` con el prompt de [07-prompts.md](07-prompts.md) §6 y la acción en JSON.
Si el revisor responde `BLOQUEAR`, la acción no se te ofrece y aparece en Actividad con el motivo; si responde `AVISAR`,
la ventana de permiso sale en rojo con la advertencia.

---

## §9 Navegador propio (Etapa 6)

```ts
// src/main/navegador/agente-navegador.ts
import { chromium, type BrowserContext, type Page } from 'playwright-core'

const BLOQUEADOS = [/(^|\.)instagram\.com$/, /(^|\.)facebook\.com$/, /(^|\.)accounts\.google\.com$/, /(^|\.)myaccount\.google\.com$/,
  /banco|bank|paypal\.com$/, /(^|\.)supabase\.com$/, /(^|\.)developers\.facebook\.com$/]

/**
 * Edge (incluido en Windows) con un perfil APARTE del tuyo: no ve tus contraseñas, cookies ni sesiones.
 * Nunca abre webs de Meta/Google/bancos: para eso están las APIs oficiales.
 */
export class NavegadorAgente {
  private ctx?: BrowserContext
  private pagina?: Page
  constructor(private readonly perfil: string, private readonly canal: 'msedge' | 'chrome') {}

  private async abrirCtx(): Promise<Page> {
    if (this.pagina) return this.pagina
    this.ctx = await chromium.launchPersistentContext(this.perfil, { channel: this.canal, headless: false, viewport: { width: 1280, height: 800 }, acceptDownloads: false })
    await this.ctx.route('**/*', (ruta) => (permitido(ruta.request().url()) ? ruta.continue() : ruta.abort()))
    this.pagina = this.ctx.pages()[0] ?? (await this.ctx.newPage())
    return this.pagina
  }

  async ir(url: string): Promise<string> {
    if (!permitido(url)) throw new Error('Ese sitio está bloqueado para el navegador del agente.')
    const p = await this.abrirCtx()
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    return this.leer()
  }

  /** Texto de la página con referencias numeradas a los elementos con los que se puede interactuar. */
  async leer(): Promise<string> {
    const p = await this.abrirCtx()
    return (await p.locator('body').ariaSnapshot()).slice(0, 12_000)
  }

  async clic(texto: string): Promise<void> {
    const p = await this.abrirCtx()
    await p.getByRole('button', { name: texto }).or(p.getByRole('link', { name: texto })).first().click({ timeout: 10_000 })
  }

  async escribir(campo: string, valor: string): Promise<void> {
    const p = await this.abrirCtx()
    const el = p.getByLabel(campo).or(p.getByPlaceholder(campo)).first()
    if ((await el.getAttribute('type')) === 'password') throw new Error('PROHIBIDO: no escribo contraseñas.')
    await el.fill(valor)
  }

  async cerrar(): Promise<void> { await this.ctx?.close(); this.ctx = undefined; this.pagina = undefined }
}

function permitido(url: string): boolean {
  try {
    const u = new URL(url)
    if (!['http:', 'https:'].includes(u.protocol)) return false
    if (['localhost', '127.0.0.1', '::1'].includes(u.hostname) || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(u.hostname)) return false
    return !BLOQUEADOS.some((re) => re.test(u.hostname))
  } catch { return false }
}
```

Herramientas: `navegador_ir` (libre), `navegador_leer` (libre), `navegador_clic` (preguntar si el texto del botón
contiene enviar/publicar/pagar/comprar/confirmar/eliminar; esos con «comprar/pagar» → bloqueado), `navegador_escribir`
(preguntar), `navegador_cerrar` (libre). Todo lo leído va envuelto como contenido externo. Dependencia nueva:
`playwright-core` (sin descargar navegadores: usa Edge del sistema).

---

## §10 Vigilante (activadores por sondeo)

```ts
// src/main/conectores/vigilante.ts
export class Vigilante {
  private temporizadores: NodeJS.Timeout[] = []
  constructor(private readonly deps: {
    gmail?: { comprobar(): Promise<Array<{ id: string; de: string; asunto: string }>>; minutos: number }
    ig?: { comprobar(): Promise<Array<{ cuenta: string; id: string; texto: string; usuario: string }>>; minutos: number }
    alEvento(tipo: 'correo' | 'comentario', datos: unknown): void
  }) {}

  iniciar(): void {
    const cada = (min: number, f: () => Promise<void>) => {
      const t = setInterval(() => void f().catch(() => undefined), min * 60_000)
      this.temporizadores.push(t)
    }
    if (this.deps.gmail) cada(this.deps.gmail.minutos, async () => { for (const c of await this.deps.gmail!.comprobar()) this.deps.alEvento('correo', c) })
    if (this.deps.ig) cada(this.deps.ig.minutos, async () => { for (const c of await this.deps.ig!.comprobar()) this.deps.alEvento('comentario', c) })
  }

  detener(): void { this.temporizadores.forEach(clearInterval); this.temporizadores = [] }
}
```

`alEvento` dispara las tareas que tengas con activador («cuando llegue un correo de…», «cuando haya un comentario
nuevo»), con la misma cola de una-en-una y «solo si hay algo» que ya tienen las Tareas. Los ids ya vistos (último
`historyId`, últimos comentarios) se guardan en `%APPDATA%\orbe\vigilante.json` para no avisar dos veces.

---

## Dependencias nuevas

| Paquete | Para qué | Etapa |
|---|---|---|
| `playwright-core` | Navegador propio con Edge del sistema | 6 |

Nada más: Gmail, Instagram y Supabase se usan con `fetch` nativo (sin SDKs), para reducir superficie y tamaño.
