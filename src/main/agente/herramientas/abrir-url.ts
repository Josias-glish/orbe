import { analizarUrlWeb } from '../red'
import { AccionProhibida, definirHerramienta, type Herramienta } from '../tipos'
import { crearEsquema, crearValidador, recortar, type Campos } from '../validacion'

const campos = {
  url: { tipo: 'texto', descripcion: 'La dirección web completa que se abrirá, p. ej. https://es.wikipedia.org/wiki/Lima.', max: 2048 }
} as const satisfies Campos

interface EntradaAbrirUrl {
  url: string
}

export interface DepsAbrirUrl {
  /** Abre la dirección en el navegador del usuario (en Electron, `shell.openExternal`). */
  abrir(url: string): Promise<void>
}

/** «Abriendo en el navegador: es.wikipedia.org/wiki/Lima»: la dirección sin el esquema, para que quepa en la línea. */
function vista(url: string): string {
  return recortar(url.trim().replace(/^https?:\/\//i, ''), 100)
}

/**
 * `abrir_url`: abre una página en el navegador del usuario. Solo http y https, sin usuario ni contraseña en la dirección
 * y sin llegar a este equipo ni a la red local (salvo ORBE_PERMITIR_LOCAL). Solo la abre: el agente no ve la página.
 */
export function crearAbrirUrl(deps: DepsAbrirUrl): Herramienta {
  return definirHerramienta<EntradaAbrirUrl>({
    nombre: 'abrir_url',
    descripcion:
      'Abre una dirección web (http o https) en el navegador del usuario. Solo la abre: no puedes ver ni leer la página, así que no la uses para consultar información (para eso, busca). ' +
      'No abre archivos, configuración del sistema ni direcciones de la red local.',
    esquema: crearEsquema(campos),
    nivel: 'libre',
    validar: crearValidador<EntradaAbrirUrl>(campos),
    describir: (e) => `Abriendo en el navegador: ${vista(e.url)}`,
    async ejecutar(e, ctx) {
      const r = analizarUrlWeb(e.url, { permitirLocal: ctx.permitirLocal })
      if (!r.ok) throw r.tipo === 'prohibida' ? new AccionProhibida(r.motivo) : new Error(r.motivo)
      await deps.abrir(r.url.href)
      return { texto: `Abrí ${r.url.href} en el navegador del usuario. No puedes ver la página.` }
    }
  })
}
