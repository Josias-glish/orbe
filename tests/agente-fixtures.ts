import { definirHerramienta, type Herramienta } from '../src/main/agente/tipos'
import { crearEsquema, crearValidador, type Campos } from '../src/main/agente/validacion'

/** Herramientas de mentira para probar el bucle de agente sin tocar nada real. */
export const camposEco = { texto: { tipo: 'texto', descripcion: 'Qué repetir', max: 100 } } as const satisfies Campos
export type EntradaEco = { texto: string }

/** Una herramienta que repite el texto y apunta lo que ejecutó. */
export function eco(extra: Partial<Herramienta<EntradaEco>> = {}): { herramienta: Herramienta; ejecutadas: string[] } {
  const ejecutadas: string[] = []
  const herramienta = definirHerramienta<EntradaEco>({
    nombre: 'eco',
    descripcion: 'Repite un texto.',
    esquema: crearEsquema(camposEco),
    nivel: 'libre',
    validar: crearValidador<EntradaEco>(camposEco),
    describir: (e) => `Repitiendo: ${e.texto}`,
    ejecutar: async (e) => {
      ejecutadas.push(e.texto)
      return { texto: e.texto }
    },
    ...extra
  })
  return { herramienta, ejecutadas }
}

export const nuncaTermina = (): Promise<never> => new Promise(() => {})
