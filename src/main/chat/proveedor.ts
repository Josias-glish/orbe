import type { MotivoFin } from '../../shared/tipos'
import type { TurnoEntrada } from './contenido'

export interface ManejadoresTurno {
  /** Llega un fragmento de la respuesta. */
  alTexto(delta: string): void
  /** El proveedor está reintentando por un fallo transitorio (conexión, saturación). */
  alReintento?(intento: number, maximo: number): void
  /** Mensaje informativo que no es parte de la respuesta (p. ej. «la sesión se reinició»). */
  alAviso?(texto: string): void
}

export interface ResultadoTurno {
  motivo: MotivoFin
}

/**
 * Una conversación con Claude. Solo admite un turno a la vez. `enviar` termina con un resultado o
 * se rechaza con un `ErrorChat` (ya traducido para el usuario).
 */
export interface ProveedorChat {
  readonly nombre: 'cli' | 'api'
  readonly modelo: string
  enviar(turno: TurnoEntrada, manejadores: ManejadoresTurno): Promise<ResultadoTurno>
  /** Detiene la respuesta en curso (el turno termina con motivo «cancelado»). */
  cancelar(): void
  /** Empieza una conversación nueva: olvida todo el contexto. */
  reiniciar(): void
  /** Prepara lo necesario para que el primer mensaje salga rápido. */
  precalentar?(): void
  cerrar(): void
}

export type Esfuerzo = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
