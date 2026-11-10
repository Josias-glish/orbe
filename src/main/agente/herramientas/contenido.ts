import { CUENTAS, NOMBRE_CUENTA, type Cuenta } from '../../conectores/instagram/cliente'
import type { AlmacenContenido } from '../../contenido/almacen'
import { definirHerramienta, type Herramienta } from '../tipos'
import { crearEsquema, crearValidador, recortar, type Campos } from '../validacion'

const MARCA = { tipo: 'opcion', descripcion: 'Marca: jsdesign (J&S Design), morfy o personal (la marca personal del usuario).', valores: CUENTAS } as const

const camposFicha = { marca: MARCA } as const satisfies Campos
const camposProponer = {
  marca: MARCA,
  idea: { tipo: 'texto', descripcion: 'La idea de la publicación en una o dos frases (para el usuario, no se publica).', max: 500 },
  texto: { tipo: 'texto', descripcion: 'El texto que irá dentro de la imagen: corto (titular y, como mucho, una línea más).', max: 300 },
  pie: { tipo: 'texto', descripcion: 'El pie de foto, sin hashtags (máximo 2200 caracteres).', max: 2200 },
  hashtags: { tipo: 'texto', descripcion: 'Hashtags separados por espacios, cada uno con # (máximo 30).', max: 900, opcional: true }
} as const satisfies Campos

interface EntradaFicha {
  marca: Cuenta
}
interface EntradaProponer extends EntradaFicha {
  idea: string
  texto: string
  pie: string
  hashtags?: string
}

/**
 * Las herramientas de contenido. Solo leen la ficha de la marca y guardan propuestas en el equipo: no publican ni
 * suben nada (eso será la Etapa 4, con aprobación). Por eso no llevan acción de conector y son libres.
 */
export function crearHerramientasContenido(almacen: AlmacenContenido, avisar: () => void): Herramienta[] {
  return [
    definirHerramienta<EntradaFicha>({
      nombre: 'contenido_ficha_marca',
      descripcion: 'Lee la ficha de una marca del usuario (público, tono, temas, hashtags habituales). Léela antes de proponer contenido para esa marca.',
      esquema: crearEsquema(camposFicha),
      nivel: 'libre',
      validar: crearValidador<EntradaFicha>(camposFicha),
      describir: (e) => `Leyendo la ficha de ${NOMBRE_CUENTA[e.marca]}`,
      async ejecutar(e) {
        return { texto: almacen.ficha(e.marca) }
      }
    }),
    definirHerramienta<EntradaProponer>({
      nombre: 'contenido_proponer',
      descripcion:
        'Guarda una propuesta de publicación de Instagram en la pestaña «Contenido» de Orbe (solo en el equipo, no publica nada). ' +
        'El usuario la revisa, la diseña en Claude Design y la aprueba él.',
      esquema: crearEsquema(camposProponer),
      nivel: 'libre',
      validar: crearValidador<EntradaProponer>(camposProponer),
      describir: (e) => `Guardando una propuesta para ${NOMBRE_CUENTA[e.marca]}: ${recortar(e.idea, 80)}`,
      async ejecutar(e) {
        const hashtags = (e.hashtags ?? '').split(/\s+/).filter((h) => /^#[\p{L}\p{N}_]+$/u.test(h)).slice(0, 30)
        const p = almacen.proponer({ marca: e.marca, idea: e.idea, texto: e.texto, pie: e.pie, hashtags })
        avisar()
        return { texto: `Propuesta guardada en Contenido (id ${p.id}). Para diseñarla, el usuario pulsa «Diseñar» en esa pestaña.` }
      }
    })
  ]
}
