import type { ClaveParte, ContextoPantalla, LecturaPantalla } from '../../shared/tipos'
import type { ResultadoLectura } from './contexto'

/** Un contexto sacado de la reserva para enviarlo; se puede devolver si el envío falla. */
export type Consumido = ResultadoLectura

export const CADUCIDAD_POR_DEFECTO_MS = 5 * 60_000

/**
 * El contexto de pantalla que el usuario ha pedido leer y que espera al próximo mensaje. Vive solo en el
 * proceso principal: la interfaz nunca puede inventar un contexto, solo pedir que se adjunte este.
 * Una pantalla vieja no se envía: caduca a los cinco minutos.
 */
export class ContextoPendiente {
  private actual: ResultadoLectura | null = null
  private temporizador: NodeJS.Timeout | null = null

  constructor(
    private readonly alCaducar: () => void,
    private readonly caducidadMs = CADUCIDAD_POR_DEFECTO_MS
  ) {}

  hay(): boolean {
    return this.actual !== null
  }

  lectura(): LecturaPantalla | null {
    return this.actual ? copiar(this.actual.lectura) : null
  }

  establecer(resultado: ResultadoLectura): LecturaPantalla {
    this.actual = { contexto: { ...resultado.contexto }, lectura: copiar(resultado.lectura) }
    this.armar()
    return copiar(this.actual.lectura)
  }

  /** Quita un trozo (el usuario no quiere enviarlo). Si no queda nada, descarta todo. */
  quitar(clave: ClaveParte): LecturaPantalla | null {
    if (!this.actual) return null
    const { contexto, lectura } = this.actual
    lectura.partes = lectura.partes.filter((p) => p.clave !== clave)
    const campos: Record<ClaveParte, (c: ContextoPantalla) => void> = {
      ventana: (c) => delete c.ventana,
      seleccion: (c) => {
        delete c.seleccion
        delete c.seleccionRecortada
      },
      contenido: (c) => {
        delete c.contenido
        delete c.contenidoRecortado
      },
      imagen: (c) => delete c.imagen
    }
    campos[clave](contexto)
    if (lectura.partes.length === 0) {
      this.descartar()
      return null
    }
    return copiar(lectura)
  }

  descartar(): void {
    this.actual = null
    this.desarmar()
  }

  /** Entrega el contexto para enviarlo y lo vacía; null si no hay o ya caducó. */
  consumir(): Consumido | null {
    const c = this.actual
    this.descartar()
    return c
  }

  /** Devuelve un contexto consumido (el envío falló) para que el usuario pueda reintentar. */
  restaurar(consumido: Consumido): LecturaPantalla {
    return this.establecer(consumido)
  }

  private armar(): void {
    this.desarmar()
    this.temporizador = setTimeout(() => {
      this.actual = null
      this.temporizador = null
      this.alCaducar()
    }, this.caducidadMs)
    this.temporizador.unref?.()
  }

  private desarmar(): void {
    if (this.temporizador) clearTimeout(this.temporizador)
    this.temporizador = null
  }
}

function copiar(l: LecturaPantalla): LecturaPantalla {
  return { partes: l.partes.map((p) => ({ ...p })), avisos: [...l.avisos], sugerirCaptura: l.sugerirCaptura }
}
