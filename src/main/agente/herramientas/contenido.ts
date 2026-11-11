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
  hashtags: { tipo: 'texto', descripcion: 'Hashtags separados por espacios, cada uno con # (máximo 30).', max: 900, opcional: true },
  imagen: {
    tipo: 'texto',
    descripcion:
      'Descripción visual, en inglés, de la foto de fondo que Orbe generará con el conector de Higgsfield del usuario (gasta sus créditos) (escena, estilo, luz, colores de la marca; sin texto ni logotipos dentro). Omítela si el diseño solo lleva tipografía y formas.',
    max: 1000,
    opcional: true
  }
} as const satisfies Campos

interface EntradaFicha {
  marca: Cuenta
}
interface EntradaProponer extends EntradaFicha {
  idea: string
  texto: string
  pie: string
  hashtags?: string
  imagen?: string
}

/**
 * Las herramientas de contenido. Solo leen la ficha de la marca y guardan propuestas en el equipo: no publican ni
 * suben nada (eso será la Etapa 4, con aprobación). Por eso no llevan acción de conector y son libres.
 */
export function crearHerramientasContenido(almacen: AlmacenContenido, alProponer: (id: string) => void): Herramienta[] {
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
        'Orbe la diseña solo en segundo plano (imagen de 1080×1350 con el estilo de la marca); el usuario la revisa y la aprueba él.',
      esquema: crearEsquema(camposProponer),
      nivel: 'libre',
      validar: crearValidador<EntradaProponer>(camposProponer),
      describir: (e) => `Guardando una propuesta para ${NOMBRE_CUENTA[e.marca]}: ${recortar(e.idea, 80)}`,
      async ejecutar(e) {
        const hashtags = (e.hashtags ?? '').split(/\s+/).filter((h) => /^#[\p{L}\p{N}_]+$/u.test(h)).slice(0, 30)
        const p = almacen.proponer({ marca: e.marca, idea: e.idea, texto: e.texto, pie: e.pie, hashtags, ...(e.imagen ? { imagen: e.imagen } : {}) })
        alProponer(p.id)
        return { texto: `Propuesta guardada en Contenido (id ${p.id}). Orbe ya la está diseñando: la imagen aparecerá en esa pestaña en un minuto o dos.` }
      }
    })
  ]
}
