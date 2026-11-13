import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { marked } from 'marked'
import { definirHerramienta, type Herramienta } from '../tipos'
import { crearEsquema, crearValidador } from '../validacion'

/** El informe en HTML con el tono de Orbe (cian a violeta), listo para imprimir. Sin scripts: solo marcado y estilos. */
export function htmlInforme(markdown: string, titulo: string): string {
  const cuerpo = marked.parse(markdown, { async: false, gfm: true }) as string
  const limpio = cuerpo.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '')
  const t = titulo.replace(/[<>&"]/g, '')
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${t}</title><style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  body { font: 10.5pt/1.55 'Segoe UI', system-ui, sans-serif; color: #1c1f33; }
  .banda { height: 6px; border-radius: 3px; background: linear-gradient(90deg, #22d3ee, #8b5cf6); margin-bottom: 14px; }
  .marca { font-size: 8.5pt; color: #6b7090; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 4px; }
  h1 { font-size: 20pt; line-height: 1.2; margin: 0 0 12px; color: #14162a; }
  h2 { font-size: 13pt; margin: 20px 0 6px; padding-bottom: 3px; border-bottom: 2px solid #8b5cf6; color: #2a2560; break-after: avoid; }
  h3 { font-size: 11pt; margin: 14px 0 4px; color: #2a2560; break-after: avoid; }
  a { color: #6d3fe0; text-decoration: none; word-break: break-word; }
  blockquote { margin: 8px 0; padding: 6px 12px; border-left: 3px solid #22d3ee; background: #f3f8fc; }
  code { font-family: Consolas, monospace; font-size: 9pt; background: #f1f1f7; padding: 1px 4px; border-radius: 3px; }
  pre { background: #f1f1f7; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 9.5pt; }
  th, td { border: 1px solid #d9dbea; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #efeafd; }
  li { margin: 2px 0; }
  hr { border: 0; border-top: 1px solid #d9dbea; margin: 18px 0; }
  @media screen { body { margin: 0; padding: 60px 56px; background: #fff; } }
  </style></head><body><div class="banda"></div><div class="marca">Orbe · ${new Date().toLocaleDateString('es-ES', { dateStyle: 'long' })}</div>${limpio}</body></html>`
}

/** Imprime el HTML a PDF en una ventana oculta de Electron, sin JavaScript ni red. */
export async function guardarPdf(markdown: string, titulo: string, rutaPdf: string): Promise<void> {
  const { BrowserWindow } = await import('electron')
  const temporal = join(tmpdir(), `orbe-pdf-${Date.now()}.html`)
  writeFileSync(temporal, htmlInforme(markdown, titulo), 'utf8')
  const ventana = new BrowserWindow({ show: false, width: 794, height: 1123, webPreferences: { javascript: false, sandbox: true, offscreen: true } })
  let ultimaImagen: Electron.NativeImage | null = null
  ventana.webContents.on('paint', (_e, _zona, imagen) => (ultimaImagen = imagen))
  // Las webs del informe no se cargan: solo el archivo local.
  ventana.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, cb) => cb({ cancel: true }))
  try {
    await ventana.loadFile(temporal)
    await new Promise((r) => setTimeout(r, 400))
    // Miniatura de la primera página para la vista previa del chat (si no llegó a pintarse, no pasa nada).
    if (ultimaImagen && !(ultimaImagen as Electron.NativeImage).isEmpty()) {
      writeFileSync(rutaPdf.replace(/\.pdf$/i, '.png'), (ultimaImagen as Electron.NativeImage).resize({ width: 360 }).toPNG())
    }
    const pdf = await ventana.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
    writeFileSync(rutaPdf, pdf)
  } finally {
    ventana.destroy()
    try {
      unlinkSync(temporal)
    } catch {
      // se lo lleva la limpieza del sistema
    }
  }
}

const campos = {
  archivo: { tipo: 'texto', descripcion: 'Nombre del archivo .md (p. ej. 2026-11-12-agentes-de-ia.md) de un informe o de un resultado de ECC.', max: 160 }
} as const

/** Convierte a PDF un informe (informes/) o un resultado de ECC (ecc/) ya guardado; el PDF queda al lado. */
export function crearHerramientaPdf(carpetas: string[], imprimir = guardarPdf): Herramienta {
  return definirHerramienta<{ archivo: string }>({
    nombre: 'convertir_a_pdf',
    descripcion:
      'Convierte a PDF, con el diseño de Orbe, un informe de investigar_a_fondo o un resultado de ecc_tarea ya guardado (archivo .md). ' +
      'Úsala cuando el usuario pida «pásalo a PDF», «hazme el PDF» o algo parecido. Si no sabes el nombre, búscalo con buscar_memoria.',
    esquema: crearEsquema(campos),
    nivel: 'libre',
    validar: crearValidador<{ archivo: string }>(campos),
    describir: (e) => `Creando el PDF de ${e.archivo}`,
    async ejecutar(e) {
      const nombre = basename(e.archivo)
      const carpeta = nombre.endsWith('.md') ? carpetas.find((c) => existsSync(join(c, nombre))) : undefined
      if (!carpeta) return { texto: `No encuentro «${nombre}» en ${carpetas.join(' ni en ')}. Búscalo con buscar_memoria.` }
      const md = readFileSync(join(carpeta, nombre), 'utf8')
      const rutaPdf = join(carpeta, nombre.replace(/\.md$/, '.pdf'))
      await imprimir(md, /^# (.+)$/m.exec(md)?.[1] ?? nombre, rutaPdf)
      return { texto: `PDF creado: ${rutaPdf}. Díselo al usuario con la ruta.` }
    }
  })
}
