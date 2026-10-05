import { randomUUID } from 'node:crypto'
import type { ErrorOrbe, EventoChat, PeticionChat } from '../../shared/tipos'
import type { PeticionConfirmacion } from '../agente/tipos'
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
  /** Confirmaciones que el agente espera del usuario en el turno activo. */
  private readonly confirmaciones = new Map<string, (permitir: boolean) => void>()

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
        alAviso: (texto) => this.emitir({ tipo: 'aviso', id, texto }),
        alAccion: (accion) => this.emitir({ tipo: 'accion', id, accion }),
        confirmar: (peticion) => this.pedirConfirmacion(id, peticion)
      })
      this.emitir({ tipo: 'fin', id, motivo: resultado.motivo })
    } catch (e) {
      this.emitir({ tipo: 'error', id, error: aErrorOrbe(e) })
    } finally {
      this.cerrarConfirmaciones()
      if (this.turnoActivo === id) this.turnoActivo = null
    }
  }

  /** Le enseña la tarjeta al usuario y espera su respuesta; si el turno termina o se detiene, cuenta como «no». */
  private pedirConfirmacion(id: string, peticion: PeticionConfirmacion): Promise<boolean> {
    if (this.turnoActivo !== id) return Promise.resolve(false)
    const confirmacionId = randomUUID()
    return new Promise<boolean>((resolver) => {
      this.confirmaciones.set(confirmacionId, resolver)
      this.emitir({ tipo: 'confirmar', id, confirmacion: { ...peticion, confirmacionId } })
    })
  }

  /** La respuesta del usuario a una tarjeta; se ignora si no corresponde al turno activo o ya se contestó. */
  responderConfirmacion(id: string, confirmacionId: string, permitir: boolean): void {
    if (this.turnoActivo !== id) return
    const resolver = this.confirmaciones.get(confirmacionId)
    if (!resolver) return
    this.confirmaciones.delete(confirmacionId)
    resolver(permitir)
  }

  private cerrarConfirmaciones(): void {
    const pendientes = [...this.confirmaciones.values()]
    this.confirmaciones.clear()
    for (const resolver of pendientes) resolver(false)
  }

  cancelar(id: string): void {
    if (this.turnoActivo !== id) return
    this.cerrarConfirmaciones()
    this.proveedor.cancelar()
  }

  /** Detiene el turno en curso sea cual sea (lo usa el menú de la bandeja). */
  cancelarActivo(): void {
    if (this.turnoActivo) this.cancelar(this.turnoActivo)
  }

  get hayTurno(): boolean {
    return this.turnoActivo !== null
  }

  /** Nueva conversación: corta lo que haya en curso y olvida el contexto. */
  nueva(): void {
    this.cerrarConfirmaciones()
    this.proveedor.reiniciar()
  }

  precalentar(): void {
    this.proveedor.precalentar?.()
  }

  cerrar(): void {
    this.cerrarConfirmaciones()
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
