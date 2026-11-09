import { definicionSecreto, type EstadoCofre, type ResultadoCofre } from '../../shared/cofre'
import type { Cofre } from './cofre'

const LARGO_MAX = 8192

/** El portapapeles del sistema: tras guardar un secreto copiado, se vacía para que no quede ahí. */
export interface Portapapeles {
  leer(): string | Promise<string>
  vaciar(): void
}

/** Comprueba lo que llega de la interfaz: un texto sin espacios ni saltos (ningún token los tiene) y no gigante. */
export function validarValorSecreto(valor: unknown): { ok: true; valor: string } | { ok: false; error: string } {
  if (typeof valor !== 'string') return { ok: false, error: 'El valor no es un texto.' }
  const limpio = valor.trim()
  if (!limpio) return { ok: false, error: 'Pega el valor antes de guardar.' }
  if (limpio.length > LARGO_MAX) return { ok: false, error: 'Es demasiado largo para ser una clave.' }
  if (/\s/.test(limpio)) return { ok: false, error: 'Tiene espacios o saltos de línea: copia solo la clave.' }
  return { ok: true, valor: limpio }
}

/**
 * Lo que hay detrás de los canales del cofre. Solo hay tres operaciones: estado (booleanos), guardar y borrar.
 * No existe ninguna forma de pedir un valor desde la interfaz.
 */
export class ControladorCofre {
  constructor(
    private readonly cofre: Cofre,
    private readonly portapapeles?: Portapapeles,
    private readonly ahora: () => Date = () => new Date()
  ) {}

  estado(): EstadoCofre {
    try {
      return { disponible: true, guardados: this.cofre.estado() }
    } catch (e) {
      return { disponible: false, error: e instanceof Error ? e.message : 'El cofre no está disponible.', guardados: {} }
    }
  }

  async guardar(clave: unknown, valor: unknown): Promise<ResultadoCofre> {
    const def = definicionSecreto(clave)
    if (!def || !def.manual) return { ok: false, error: 'Ese secreto no se puede guardar desde aquí.', estado: this.estado() }
    const v = validarValorSecreto(valor)
    if (!v.ok) return { ok: false, error: v.error, estado: this.estado() }
    try {
      this.cofre.guardar(def.clave, def.forma === 'token_ig' ? { token: v.valor, renovado: this.ahora().toISOString() } : v.valor)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'No se pudo guardar.', estado: this.estado() }
    }
    // Si lo pegó desde el portapapeles, no lo dejamos ahí (otra app podría leerlo).
    try {
      if (this.portapapeles && (await this.portapapeles.leer()).trim() === v.valor) this.portapapeles.vaciar()
    } catch {
      // el portapapeles es un extra: si falla, el secreto ya está guardado
    }
    return { ok: true, estado: this.estado() }
  }

  borrar(clave: unknown): ResultadoCofre {
    const def = definicionSecreto(clave)
    if (!def) return { ok: false, error: 'Ese secreto no existe.', estado: this.estado() }
    try {
      this.cofre.borrar(def.clave)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'No se pudo borrar.', estado: this.estado() }
    }
    return { ok: true, estado: this.estado() }
  }
}
