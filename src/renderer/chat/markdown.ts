import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Marked, type TokenizerAndRendererExtension } from 'marked'

function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------------------------
// Fórmulas (LaTeX) con KaTeX
// ---------------------------------------------------------------------------------------------

/**
 * Las fórmulas se sacan del Markdown como marcadores de texto, se sanea el HTML y después se sustituye cada marcador
 * por lo que genera KaTeX. KaTeX necesita clases y estilos que el saneado quita, y su salida es segura: con
 * `trust: false` no admite enlaces, HTML ni nada que ejecute código; solo dibuja la fórmula.
 */
let formulas: string[] = []
let sello = ''

function marcador(tex: string, bloque: boolean): string {
  formulas.push(
    katex.renderToString(tex, { displayMode: bloque, throwOnError: false, trust: false, strict: 'ignore', output: 'htmlAndMathml', maxExpand: 500, maxSize: 20 })
  )
  return `${sello}${formulas.length - 1}${sello}`
}

interface TokenFormula {
  type: string
  raw: string
  tex: string
  bloque: boolean
}

const FORMULA_BLOQUE: TokenizerAndRendererExtension = {
  name: 'formulaBloque',
  level: 'block',
  start: (src) => src.match(/\$\$|\\\[/)?.index,
  tokenizer(src) {
    const m = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n|$)/.exec(src)
    if (!m) return undefined
    return { type: 'formulaBloque', raw: m[0], tex: (m[1] ?? m[2]).trim(), bloque: true } as TokenFormula
  },
  renderer: (t) => `<p>${marcador((t as unknown as TokenFormula).tex, true)}</p>`
}

const FORMULA_LINEA: TokenizerAndRendererExtension = {
  name: 'formulaLinea',
  level: 'inline',
  start: (src) => src.match(/\$|\\\(/)?.index,
  tokenizer(src) {
    // $$…$$ en mitad de un párrafo, \(…\) y $…$. Para no confundir precios («cuesta $5 y $10»), $…$ no puede
    // empezar ni acabar con un espacio y no puede ir seguido de una cifra.
    const m =
      /^\$\$([^$]+?)\$\$/.exec(src) ?? /^\\\(([\s\S]+?)\\\)/.exec(src) ?? /^\$(?![\s$])((?:\\\$|[^$\n])+?)(?<![\s\\])\$(?!\d)/.exec(src)
    if (!m) return undefined
    return { type: 'formulaLinea', raw: m[0], tex: m[1].trim(), bloque: m[0].startsWith('$$') } as TokenFormula
  },
  renderer: (t) => marcador((t as unknown as TokenFormula).tex, (t as unknown as TokenFormula).bloque)
}

const marcado = new Marked({
  gfm: true,
  breaks: false,
  extensions: [FORMULA_BLOQUE, FORMULA_LINEA],
  renderer: {
    // La interfaz no carga imágenes remotas (CSP y privacidad): se muestra su texto alternativo.
    image({ text }) {
      return `<em class="imagen-bloqueada">[imagen: ${escaparHtml(text || 'sin descripción')}]</em>`
    }
  }
})

// Todo enlace se abre fuera de la app y sin dar pistas al sitio de destino.
DOMPurify.addHook('afterSanitizeAttributes', (nodo) => {
  if (nodo.tagName === 'A') {
    nodo.setAttribute('rel', 'noopener noreferrer')
    nodo.removeAttribute('target')
  }
})

/** Convierte Markdown en HTML seguro. Vale tanto para texto completo como para respuestas a medias. */
export function renderizarMarkdown(texto: string): string {
  formulas = []
  // Un sello distinto en cada llamada: un texto no puede fabricar un marcador que coincida.
  sello = `\u2063${Math.random().toString(36).slice(2, 10)}\u2063`
  try {
    const html = marcado.parse(texto, { async: false })
    const limpio = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'img', 'iframe'],
      FORBID_ATTR: ['style', 'class', 'id']
    })
    if (formulas.length === 0) return limpio
    const patron = new RegExp(`${sello}(\\d+)${sello}`, 'g')
    return limpio.replace(patron, (todo, n: string) => formulas[Number(n)] ?? todo)
  } finally {
    formulas = []
  }
}
