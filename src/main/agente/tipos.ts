import type { ConfirmacionVista } from '../../shared/tipos'

/** Lo que una herramienta pide al usuario: la acción exacta (el id lo pone quien la muestra). */
export type PeticionConfirmacion = Omit<ConfirmacionVista, 'confirmacionId'>

/** `libre` se ejecuta sin preguntar; `confirmar` siempre pide permiso al usuario antes. */
export type NivelPermiso = 'libre' | 'confirmar'

/** Lo que la política decide sobre una llamada concreta, antes de ejecutarla. */
export type Decision =
  | { tipo: 'permitir' }
  | ({ tipo: 'confirmar' } & Pick<PeticionConfirmacion, 'titulo' | 'detalle' | 'peligrosa'>)
  /** No se puede hacer ni con permiso: el agente debe parar y pedirle al usuario que lo haga él. */
  | { tipo: 'prohibir'; motivo: string }

/** JSON Schema de la entrada de una herramienta: un objeto plano sin campos de más. */
export interface EsquemaEntrada {
  type: 'object'
  properties: Record<string, Record<string, unknown>>
  required: string[]
  additionalProperties: false
  [clave: string]: unknown
}

export type Validacion<T> = { ok: true; valor: T } | { ok: false; error: string }

export interface ContextoHerramienta {
  /** Se activa cuando el usuario pulsa Detener: la herramienta debe soltar lo que esté haciendo. */
  senal: AbortSignal
  /** Pregunta al usuario y espera su respuesta; es `false` si cancela o si se detiene la tarea. */
  preguntar(peticion: PeticionConfirmacion): Promise<boolean>
  /** Desde ahora, y hasta que acabe la tarea, toda acción (incluso las libres) pide permiso. */
  vigilar(): void
  /** El usuario permitió que el agente llegue a localhost y a redes privadas (ORBE_PERMITIR_LOCAL). */
  permitirLocal: boolean
}

export interface ResultadoEjecucion {
  texto: string
  /**
   * El texto viene de fuera (una página, un buscador): se entrega al modelo dentro de un bloque
   * `<contenido_externo>` para que lo trate como datos y nunca como instrucciones.
   */
  externo?: { origen: string; url?: string }
  /** De dónde salió la información: se enseña como enlaces bajo la respuesta. */
  fuentes?: Array<{ titulo: string; url: string }>
}

export interface Herramienta<T = unknown> {
  /** Solo letras, números, guion y guion bajo: lo exigen las dos APIs. */
  nombre: string
  descripcion: string
  esquema: EsquemaEntrada
  nivel: NivelPermiso
  /** Comprueba y limpia lo que mandó el modelo; nunca se ejecuta nada con entrada sin validar. */
  validar(entrada: unknown): Validacion<T>
  /** La línea del chat («Buscando: tiempo en Lima»). */
  describir(entrada: T): string
  /** Afina el permiso según los parámetros (p. ej. un clic en «Comprar»). Sin respuesta vale `nivel`. */
  clasificar?(entrada: T): Decision | undefined
  ejecutar(entrada: T, ctx: ContextoHerramienta): Promise<ResultadoEjecucion>
}

/** Una petición del modelo para usar una de nuestras herramientas. */
export interface LlamadaHerramienta {
  id: string
  nombre: string
  entrada: unknown
  /** Los parámetros ni siquiera eran un JSON válido: no se ejecuta y se le dice al modelo. */
  errorEntrada?: string
}

/** Lo que se le devuelve al modelo por cada llamada (siempre uno por llamada, aunque falle). */
export interface ResultadoLlamada {
  id: string
  contenido: string
  esError: boolean
}

/** Da forma a una herramienta con parámetros tipados para guardarla en un registro común. */
export function definirHerramienta<T>(herramienta: Herramienta<T>): Herramienta {
  return herramienta as unknown as Herramienta
}
