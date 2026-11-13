import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'

export type ProveedorVision = 'ninguno' | 'claude-cli' | 'ollama' | 'anthropic' | 'openai' | 'gemini' | 'openrouter'
export const PROVEEDORES: readonly ProveedorVision[] = ['ninguno', 'claude-cli', 'ollama', 'anthropic', 'openai', 'gemini', 'openrouter']

/** URLs base de VISION-Y-DATOS.md §2 (formato compatible con OpenAI salvo Anthropic y el CLI). */
const BASE: Record<string, string> = {
  ollama: 'http://127.0.0.1:11434/v1',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1'
}

export interface PeticionVision {
  proveedor: ProveedorVision
  modelo: string
  /** JPEG ya preparado (sin metadatos), en base64. */
  jpeg: string
  prompt: string
  clave?: string
  baseUrl?: string
  rutaCli?: string
  cwd?: string
  senal?: AbortSignal
  pedir?: typeof fetch
  lanzar?: typeof spawn
}

/** Un error del proveedor, sin la clave aunque el servidor la devuelva: solo el estado y un trozo del cuerpo. */
function errorProveedor(nombre: string, estado: number, cuerpo: string, clave?: string): Error {
  let t = cuerpo.slice(0, 300)
  if (clave) t = t.split(clave).join('***')
  return new Error(`${nombre} respondió ${estado}: ${t.replace(/\s+/g, ' ').trim() || 'sin detalle'}`)
}

/** La descripción de una imagen en texto (el JSON lo valida quien llama). La clave va siempre en una cabecera. */
export async function describirImagen(p: PeticionVision): Promise<string> {
  const pedir = p.pedir ?? fetch
  const usuario = 'Analiza esta imagen.'
  if (p.proveedor === 'claude-cli') return describirConCli(p, usuario)
  if (p.proveedor === 'anthropic') {
    if (!p.clave) throw new Error('Falta la clave de visión (Configuración → Conectores → Visión).')
    const r = await pedir(p.baseUrl || 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: p.senal,
      headers: { 'content-type': 'application/json', 'x-api-key': p.clave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: p.modelo,
        max_tokens: 1024,
        system: p.prompt,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.jpeg } }, { type: 'text', text: usuario }] }]
      })
    })
    const cuerpo = await r.text()
    if (!r.ok) throw errorProveedor('Anthropic', r.status, cuerpo, p.clave)
    const j = JSON.parse(cuerpo) as { content?: Array<{ type: string; text?: string }> }
    return (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
  }
  const base = (p.baseUrl || BASE[p.proveedor] || '').replace(/\/$/, '')
  if (!base) throw new Error(`Proveedor de visión desconocido: ${p.proveedor}.`)
  if (p.proveedor === 'ollama' && !/^http:\/\/127\.0\.0\.1[:/]/.test(`${base}/`)) throw new Error('Ollama solo se usa en 127.0.0.1.')
  if (p.proveedor !== 'ollama' && !p.clave) throw new Error('Falta la clave de visión (Configuración → Conectores → Visión).')
  const r = await pedir(`${base}/chat/completions`, {
    method: 'POST',
    signal: p.senal,
    headers: { 'content-type': 'application/json', ...(p.clave ? { authorization: `Bearer ${p.clave}` } : {}) },
    body: JSON.stringify({
      model: p.modelo,
      messages: [
        { role: 'system', content: p.prompt },
        { role: 'user', content: [{ type: 'text', text: usuario }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${p.jpeg}` } }] }
      ]
    })
  })
  const cuerpo = await r.text()
  if (!r.ok) throw errorProveedor(p.proveedor, r.status, cuerpo, p.clave)
  const j = JSON.parse(cuerpo) as { choices?: Array<{ message?: { content?: string } }> }
  return j.choices?.[0]?.message?.content ?? ''
}

/**
 * Con la suscripción de Claude (verificado el 12-nov): el CLI acepta la imagen como mensaje `stream-json` y sin
 * herramientas solo puede describirla. Sin claves ni plugins del usuario.
 */
async function describirConCli(p: PeticionVision, usuario: string): Promise<string> {
  if (!p.rutaCli || !p.cwd) throw new Error('No encuentro el CLI de Claude.')
  mkdirSync(p.cwd, { recursive: true })
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const v of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_PLUGIN_DIRS']) delete env[v]
  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', p.modelo || 'haiku',
    '--system-prompt', p.prompt, '--setting-sources', '', '--strict-mcp-config', '--tools', '', '--no-session-persistence'
  ]
  const hijo = (p.lanzar ?? spawn)(p.rutaCli, args, { cwd: p.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const salida = await new Promise<string>((resolver, rechazar) => {
    let texto = ''
    const fin = setTimeout(() => (hijo.kill(), rechazar(new Error('La visión tardó demasiado.'))), 120_000)
    const cancelar = (): void => void hijo.kill()
    p.senal?.addEventListener('abort', cancelar, { once: true })
    hijo.stdout?.setEncoding('utf8')
    hijo.stdout?.on('data', (t: string) => (texto += t))
    hijo.on('error', (e) => (clearTimeout(fin), rechazar(e)))
    hijo.on('close', () => (clearTimeout(fin), p.senal?.removeEventListener('abort', cancelar), resolver(texto)))
    const mensaje = { type: 'user', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.jpeg } }, { type: 'text', text: usuario }] } }
    hijo.stdin?.end(`${JSON.stringify(mensaje)}\n`)
  })
  const linea = salida.split('\n').reverse().find((l) => l.includes('"type":"result"'))
  const r = linea ? (JSON.parse(linea) as { result?: unknown; is_error?: unknown }) : null
  if (!r || r.is_error === true || typeof r.result !== 'string') throw new Error(`El CLI de Claude no pudo describir la imagen: ${String(r?.result ?? 'sin respuesta').slice(0, 200)}`)
  return r.result
}
