import type { EsquemaEntrada, Herramienta } from './tipos'

/** Herramienta en el formato de la API de Anthropic. */
export interface DefinicionAnthropic {
  name: string
  description: string
  input_schema: EsquemaEntrada
}

/** Herramienta en el formato de «chat completions» de OpenAI. */
export interface DefinicionOpenai {
  type: 'function'
  function: { name: string; description: string; parameters: EsquemaEntrada }
}

const NOMBRE_VALIDO = /^[a-zA-Z0-9_-]{1,64}$/

/** Las herramientas que el agente tiene a mano: es la única superficie por la que puede actuar. */
export class RegistroHerramientas {
  private readonly porNombre = new Map<string, Herramienta>()

  constructor(herramientas: readonly Herramienta[] = []) {
    for (const h of herramientas) {
      if (!NOMBRE_VALIDO.test(h.nombre)) throw new Error(`Nombre de herramienta no válido: «${h.nombre}».`)
      if (this.porNombre.has(h.nombre)) throw new Error(`La herramienta «${h.nombre}» está repetida.`)
      this.porNombre.set(h.nombre, h)
    }
  }

  get vacio(): boolean {
    return this.porNombre.size === 0
  }

  get nombres(): string[] {
    return [...this.porNombre.keys()]
  }

  buscar(nombre: string): Herramienta | undefined {
    return this.porNombre.get(nombre)
  }

  paraAnthropic(): DefinicionAnthropic[] {
    return [...this.porNombre.values()].map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: h.esquema }))
  }

  paraOpenai(): DefinicionOpenai[] {
    return [...this.porNombre.values()].map((h) => ({
      type: 'function',
      function: { name: h.nombre, description: h.descripcion, parameters: h.esquema }
    }))
  }
}
