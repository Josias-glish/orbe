import DOMPurify from 'dompurify'
import { Marked } from 'marked'

function escaparHtml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const marcado = new Marked({
  gfm: true,
  breaks: false,
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
  const html = marcado.parse(texto, { async: false })
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'img', 'iframe'],
    FORBID_ATTR: ['style', 'class', 'id']
  })
}
