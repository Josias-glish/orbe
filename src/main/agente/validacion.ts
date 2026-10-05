import type { EsquemaEntrada, Validacion } from './tipos'

/** Un campo de la entrada de una herramienta. El mismo dato genera el JSON Schema y el validador, para que no se desajusten. */
export type Campo =
  | { tipo: 'texto'; descripcion: string; max: number; min?: number; opcional?: boolean }
  | { tipo: 'entero'; descripcion: string; min: number; max: number; opcional?: boolean }
  | { tipo: 'opcion'; descripcion: string; valores: readonly string[]; opcional?: boolean }
  | { tipo: 'booleano'; descripcion: string; opcional?: boolean }

export type Campos = Record<string, Campo>

function esquemaCampo(campo: Campo): Record<string, unknown> {
  switch (campo.tipo) {
    case 'texto':
      return { type: 'string', description: campo.descripcion, minLength: campo.min ?? 1, maxLength: campo.max }
    case 'entero':
      return { type: 'integer', description: campo.descripcion, minimum: campo.min, maximum: campo.max }
    case 'opcion':
      return { type: 'string', description: campo.descripcion, enum: [...campo.valores] }
    case 'booleano':
      return { type: 'boolean', description: campo.descripcion }
  }
}

export function crearEsquema(campos: Campos): EsquemaEntrada {
  return {
    type: 'object',
    properties: Object.fromEntries(Object.entries(campos).map(([nombre, campo]) => [nombre, esquemaCampo(campo)])),
    required: Object.entries(campos)
      .filter(([, campo]) => !campo.opcional)
      .map(([nombre]) => nombre),
    additionalProperties: false
  }
}

function validarCampo(nombre: string, campo: Campo, valor: unknown): Validacion<unknown> {
  switch (campo.tipo) {
    case 'texto': {
      if (typeof valor !== 'string') return { ok: false, error: `«${nombre}» debe ser un texto.` }
      if (valor.includes('\u0000')) return { ok: false, error: `«${nombre}» tiene caracteres no permitidos.` }
      if (valor.length < (campo.min ?? 1)) return { ok: false, error: `«${nombre}» no puede estar vacío.` }
      if (valor.length > campo.max) return { ok: false, error: `«${nombre}» es demasiado largo (máximo ${campo.max} caracteres).` }
      return { ok: true, valor }
    }
    case 'entero': {
      if (typeof valor !== 'number' || !Number.isInteger(valor)) return { ok: false, error: `«${nombre}» debe ser un número entero.` }
      if (valor < campo.min || valor > campo.max) {
        return { ok: false, error: `«${nombre}» debe estar entre ${campo.min} y ${campo.max}.` }
      }
      return { ok: true, valor }
    }
    case 'opcion': {
      if (typeof valor !== 'string' || !campo.valores.includes(valor)) {
        return { ok: false, error: `«${nombre}» debe ser uno de: ${campo.valores.join(', ')}.` }
      }
      return { ok: true, valor }
    }
    case 'booleano': {
      if (typeof valor !== 'boolean') return { ok: false, error: `«${nombre}» debe ser verdadero o falso.` }
      return { ok: true, valor }
    }
  }
}

/**
 * Valida una entrada contra los campos: tiene que ser un objeto, sin campos desconocidos, con los obligatorios
 * y con el tipo y los límites de cada uno. Los mensajes dicen qué corregir para que el modelo pueda reintentar.
 */
export function crearValidador<T>(campos: Campos): (entrada: unknown) => Validacion<T> {
  return (entrada) => {
    if (typeof entrada !== 'object' || entrada === null || Array.isArray(entrada)) {
      return { ok: false, error: 'Los parámetros deben ser un objeto.' }
    }
    const recibido = entrada as Record<string, unknown>
    const desconocidos = Object.keys(recibido).filter((nombre) => !(nombre in campos))
    if (desconocidos.length > 0) {
      return { ok: false, error: `Parámetros que no existen: ${desconocidos.join(', ')}. Los válidos son: ${Object.keys(campos).join(', ')}.` }
    }
    const resultado: Record<string, unknown> = {}
    for (const [nombre, campo] of Object.entries(campos)) {
      const valor = recibido[nombre]
      if (valor === undefined) {
        if (campo.opcional) continue
        return { ok: false, error: `Falta el parámetro obligatorio «${nombre}».` }
      }
      const r = validarCampo(nombre, campo, valor)
      if (!r.ok) return r
      resultado[nombre] = r.valor
    }
    return { ok: true, valor: resultado as T }
  }
}

/** Recorta un texto para mostrarlo en el chat, marcando que se cortó. */
export function recortar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, Math.max(0, max - 1))}…`
}
