import type { ErrorOrbe, EventoChat, PeticionChat } from '../../shared/tipos'
import type { TurnoEntrada } from './contenido'
import { aErrorOrbe, crearError } from './errores'
import type { ProveedorChat } from './proveedor'

export const MAX_TEXTO = 20_000

export type ResultadoInicio = { ok: true } | { ok: false; error: ErrorOrbe }

/** Lo que la aplicación añade al mensaje del usuario además de su texto y del contexto de pantalla. */
export type ExtraTurno = Pick<TurnoEntrada, 'historialPrevio' | 'notaApp'>

/** Orquesta los turnos del chat: valida la petición, lanza el turno y traduce todo a eventos. */
export class ServicioChat {
  private turnoActivo: string | null = null

  constructor(
    private readonly proveedor: ProveedorChat,
    private readonly emitir: (evento: EventoChat) => void
  ) {}

  /** ¿Se puede empezar un turno con esta petición? No lo empieza: sirve para decidir antes de gastar contexto o memoria. */
  comprobar(peticion: unknown): { ok: true; peticion: PeticionChat } | { ok: false; error: ErrorOrbe } {
    const valida = validarPeticion(peticion)
    if (!valida) {
      return { ok: false, error: crearError('solicitud_invalida', { mensaje: 'El mensaje no es válido.' }) }
    }
    if (this.turnoActivo) {
      return {
        ok: false,
        error: crearError('solicitud_invalida', { mensaje: 'Todavía estoy respondiendo al mensaje anterior.' })
      }
    }
    return { ok: true, peticion: valida }
  }

  /** Valida y arranca el turno; el contenido de la respuesta llega después por eventos. */
  iniciar(peticion: unknown, contexto?: TurnoEntrada['contexto'], extra: ExtraTurno = {}): ResultadoInicio {
    const comprobada = this.comprobar(peticion)
    if (!comprobada.ok) return comprobada

    const { id, texto } = comprobada.peticion
    this.turnoActivo = id
    this.emitir({ tipo: 'inicio', id })
    void this.ejecutar(id, { texto, contexto, ...extra })
    return { ok: true }
  }

  private async ejecutar(id: string, turno: TurnoEntrada): Promise<void> {
    try {
      const resultado = await this.proveedor.enviar(turno, {
        alTexto: (delta) => this.emitir({ tipo: 'texto', id, delta }),
        alReintento: (intento, maximo) => this.emitir({ tipo: 'reintento', id, intento, maximo }),
        alAviso: (texto) => this.emitir({ tipo: 'aviso', id, texto })
      })
      this.emitir({ tipo: 'fin', id, motivo: resultado.motivo })
    } catch (e) {
      this.emitir({ tipo: 'error', id, error: aErrorOrbe(e) })
    } finally {
      if (this.turnoActivo === id) this.turnoActivo = null
    }
  }

  cancelar(id: string): void {
    if (this.turnoActivo === id) this.proveedor.cancelar()
  }

  /** Nueva conversación: corta lo que haya en curso y olvida el contexto. */
  nueva(): void {
    this.proveedor.reiniciar()
  }

  precalentar(): void {
    this.proveedor.precalentar?.()
  }

  cerrar(): void {
    this.proveedor.cerrar()
  }
}

function validarPeticion(peticion: unknown): PeticionChat | null {
  if (typeof peticion !== 'object' || peticion === null) return null
  const { id, texto } = peticion as Record<string, unknown>
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null
  if (typeof texto !== 'string') return null
  const limpio = texto.trim()
  if (limpio.length === 0 || limpio.length > MAX_TEXTO) return null
  return { id, texto: limpio }
}
