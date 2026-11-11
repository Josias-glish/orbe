import { spawn } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { NOMBRE_CUENTA } from '../conectores/instagram/cliente'
import type { AlmacenContenido } from './almacen'

/** Lanza el diseñador con un prompt y devuelve su respuesta de texto. */
export type LanzarDisenador = (prompt: string, carpetaMarca: string, senal: AbortSignal) => Promise<string>
/** Descarga la foto que generó Higgsfield. */
export type Descargar = (url: string, senal: AbortSignal) => Promise<{ datos: Buffer; mime: string }>

/** Generar la foto con Higgsfield y componer puede tardar varios minutos. */
const LIMITE_MS = 8 * 60_000
const PESO_FOTO_MAX = 20 * 1024 * 1024
/** El nombre que el diseñador escribe donde va la foto de Higgsfield; Orbe lo cambia por el archivo real. */
export const MARCA_FONDO = 'FONDO_IMAGEN'

/**
 * Las únicas herramientas del diseñador: leer la carpeta de la marca y, por el conector de Higgsfield de la cuenta de
 * Claude del usuario, generar la foto y esperar el resultado. `ToolSearch` hace falta porque las herramientas de los
 * conectores llegan diferidas. Todo lo demás (consola, web, otros conectores) queda denegado sin preguntar.
 */
export const HERRAMIENTAS_DISENADOR = [
  'Read',
  'Glob',
  'ToolSearch',
  'mcp__claude_ai_Higgsfield__generate_image_batch',
  'mcp__claude_ai_Higgsfield__jobs_wait'
]

export const PROMPT_DISENADOR = `Eres diseñador gráfico de marcas para Instagram. Tu único trabajo es devolver diseños en HTML.
Antes de diseñar, lee con Read la ficha marca.md de la carpeta de trabajo y, si existe, la carpeta design/ (exportación
de Claude Design con colores, tipografías, logotipo y plantillas de la marca): usa SOLO ese estilo. Si no hay design/,
crea un estilo sobrio y coherente con la ficha.

Requisitos de cada diseño (uno por diapositiva):
- Un documento HTML completo, de <!doctype html> a </html>, con <body> de exactamente 1080×1350 px y sin márgenes.
- Estilos en <style> o en línea. SIN JavaScript. SIN recursos de internet: solo archivos de la carpeta de la marca
  (rutas relativas), imágenes en data: URI o la foto de fondo con el nombre ${MARCA_FONDO} si se te pide.
- Texto legible: mínimo 40 px en titulares y 28 px en el resto. Contraste alto. Margen de seguridad de 80 px.
- Nada de texto de relleno ni marcas de agua.

Responde SOLO con lo que se te pide (la línea FONDO_URL si hay foto y los documentos HTML), sin explicaciones.`

/** Los documentos HTML completos que hay en la respuesta del diseñador, en orden. */
export function extraerHtml(respuesta: string): string[] {
  return [...respuesta.matchAll(/(?:<!doctype html>\s*)?<html[\s\S]*?<\/html>/gi)].map((m) => m[0])
}

/** La dirección de la foto de Higgsfield que el diseñador anota en la línea `FONDO_URL: https://…`. */
export function extraerFondo(respuesta: string): string | null {
  return /^FONDO_URL:\s*(https:\/\/\S+)\s*$/im.exec(respuesta)?.[1] ?? null
}

/**
 * Argumentos del CLI para diseñar. Sin `--strict-mcp-config` para que lleguen los conectores de la cuenta de Claude
 * (Higgsfield), pero solo se permiten `HERRAMIENTAS_DISENADOR` y el resto se niega (`dontAsk`).
 */
export function argumentosDisenador(): string[] {
  return [
    '-p',
    '--output-format', 'json',
    '--model', 'sonnet',
    '--tools', 'Read,Glob,ToolSearch',
    '--allowedTools', HERRAMIENTAS_DISENADOR.join(','),
    '--permission-mode', 'dontAsk',
    '--system-prompt', PROMPT_DISENADOR,
    '--setting-sources', '',
    '--no-session-persistence',
    '--disable-slash-commands'
  ]
}

/** El diseñador real: `claude -p` con la carpeta de la marca como directorio de trabajo y el prompt por la entrada. */
export function lanzadorCli(ruta: string): LanzarDisenador {
  return (prompt, carpeta, senal) =>
    new Promise((resolver, rechazar) => {
      // Sesión de Claude del usuario (sin API key suelta) y conectores diferidos: sin esto sus herramientas no caben.
      const env: NodeJS.ProcessEnv = { ...process.env, ENABLE_TOOL_SEARCH: 'true' }
      delete env.ANTHROPIC_API_KEY
      delete env.ANTHROPIC_AUTH_TOKEN
      const hijo = spawn(ruta, argumentosDisenador(), { cwd: carpeta, env, windowsHide: true, signal: senal })
      let salida = ''
      let errores = ''
      hijo.stdout.setEncoding('utf8').on('data', (t: string) => (salida += t))
      hijo.stderr.setEncoding('utf8').on('data', (t: string) => (errores = (errores + t).slice(-2000)))
      hijo.on('error', rechazar)
      hijo.on('close', (codigo) => {
        try {
          const r = JSON.parse(salida) as { result?: string; is_error?: boolean }
          if (r.is_error || typeof r.result !== 'string') throw new Error(r.result || 'sin respuesta')
          resolver(r.result)
        } catch (e) {
          rechazar(new Error(`El CLI de Claude no devolvió un diseño (código ${codigo}): ${e instanceof Error ? e.message : ''} ${errores}`.trim()))
        }
      })
      hijo.stdin.end(prompt)
    })
}

/** Descarga real: solo https, solo imágenes y con tope de peso. */
export const descargarFoto: Descargar = async (url, senal) => {
  const r = await fetch(url, { signal: senal })
  const mime = r.headers.get('content-type')?.split(';')[0].trim() ?? ''
  if (!r.ok || !mime.startsWith('image/')) throw new Error(`No he podido descargar la foto de Higgsfield (${r.status}).`)
  const datos = Buffer.from(await r.arrayBuffer())
  if (datos.length > PESO_FOTO_MAX) throw new Error('La foto de Higgsfield pesa demasiado.')
  return { datos, mime }
}

/**
 * Diseña las piezas sin intervención: el CLI de Claude genera la foto con Higgsfield (si la pieza trae descripción
 * visual), escribe el HTML con el estilo de la marca y Orbe lo convierte en PNG (ventana oculta sin red ni JavaScript).
 * Una pieza a la vez por id; los fallos quedan anotados para la pestaña.
 */
export class Disenador {
  readonly enCurso = new Set<string>()
  readonly errores = new Map<string, string>()

  constructor(
    private readonly almacen: AlmacenContenido,
    private readonly lanzar: LanzarDisenador,
    private readonly renderizar: (html: string, carpetaMarca: string) => Promise<Buffer>,
    private readonly avisar: () => void,
    private readonly descargar: Descargar = descargarFoto
  ) {}

  async disenar(id: string): Promise<void> {
    if (this.enCurso.has(id)) return
    const pieza = this.almacen.lista().find((p) => p.id === id)
    if (!pieza) throw new Error('Esa pieza ya no existe.')
    this.enCurso.add(id)
    this.errores.delete(id)
    this.avisar()
    const carpeta = this.almacen.carpetaMarca(pieza.marca)
    let nombreFondo = ''
    try {
      const prompt = [
        `Marca: ${NOMBRE_CUENTA[pieza.marca]}.`,
        `Idea: ${pieza.idea}`,
        `Texto que va en la imagen (máx. 12 palabras por diapositiva): ${pieza.texto || '(elige un titular breve a partir de la idea)'}`,
        'Formato: una sola imagen salvo que el texto pida claramente varias diapositivas (como mucho 5).',
        ...(pieza.imagen
          ? [
              '',
              'Foto de fondo: genérala con Higgsfield. Carga con ToolSearch «select:mcp__claude_ai_Higgsfield__generate_image_batch,mcp__claude_ai_Higgsfield__jobs_wait»',
              '(si dice que el conector aún se conecta, repite hasta 3 veces). Llama a generate_image_batch con un solo elemento:',
              `model "gpt_image_2_6", aspect_ratio "3:4", use_unlim false, y este prompt: ${pieza.imagen}`,
              'Espera con jobs_wait hasta que termine. Escribe la dirección de la imagen en una línea propia «FONDO_URL: https://…»',
              `y úsala en el HTML a sangre (object-fit: cover) escribiendo exactamente ${MARCA_FONDO} como su dirección`,
              `(src="${MARCA_FONDO}" o url(${MARCA_FONDO})). Asegura el contraste del texto con un degradado o una franja.`,
              'Si Higgsfield falla, diseña sin foto y no escribas la línea FONDO_URL.'
            ]
          : [])
      ].join('\n')
      const senal = AbortSignal.timeout(LIMITE_MS)
      const respuesta = await this.lanzar(prompt, carpeta, senal)
      const htmls = extraerHtml(respuesta).slice(0, 5)
      if (htmls.length === 0) throw new Error('El diseñador no devolvió ningún HTML.')
      const url = extraerFondo(respuesta)
      if (url && htmls.some((h) => h.includes(MARCA_FONDO))) {
        const foto = await this.descargar(url, senal)
        nombreFondo = `.fondo-${id}.${foto.mime === 'image/png' ? 'png' : foto.mime === 'image/webp' ? 'webp' : 'jpg'}`
        writeFileSync(join(carpeta, nombreFondo), foto.datos)
      }
      const pngs: Buffer[] = []
      for (const html of htmls) pngs.push(await this.renderizar(nombreFondo ? html.replaceAll(MARCA_FONDO, nombreFondo) : html, carpeta))
      this.almacen.ponerImagenes(id, pngs)
    } catch (e) {
      this.errores.set(id, e instanceof Error ? e.message.slice(0, 400) : String(e))
    } finally {
      if (nombreFondo) rmSync(join(carpeta, nombreFondo), { force: true })
      this.enCurso.delete(id)
      this.avisar()
    }
  }
}
