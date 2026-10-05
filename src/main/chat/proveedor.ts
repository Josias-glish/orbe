import type { AccionVista, InfoPotencia, MotivoFin, NivelEsfuerzo } from '../../shared/tipos'
import type { PeticionConfirmacion } from '../agente/tipos'
import type { TurnoEntrada } from './contenido'

export interface ManejadoresTurno {
  /** Llega un fragmento de la respuesta. */
  alTexto(delta: string): void
  /** El proveedor está reintentando por un fallo transitorio (conexión, saturación). */
  alReintento?(intento: number, maximo: number): void
  /** Mensaje informativo que no es parte de la respuesta (p. ej. «la sesión se reinició»). */
  alAviso?(texto: string): void
  /** El agente empieza o termina una acción (llega dos veces con el mismo `accionId`). */
  alAccion?(accion: AccionVista): void
  /** El agente pide permiso al usuario para una acción; resuelve `true` si la permite. */
  confirmar?(peticion: PeticionConfirmacion): Promise<boolean>
}

export interface ResultadoTurno {
  motivo: MotivoFin
}

/**
 * Una conversación con Claude. Solo admite un turno a la vez. `enviar` termina con un resultado o
 * se rechaza con un `ErrorChat` (ya traducido para el usuario).
 */
export interface ProveedorChat {
  readonly nombre: 'cli' | 'api' | 'openai'
  readonly modelo: string
  enviar(turno: TurnoEntrada, manejadores: ManejadoresTurno): Promise<ResultadoTurno>
  /** Detiene la respuesta en curso (el turno termina con motivo «cancelado»). */
  cancelar(): void
  /** Empieza una conversación nueva: olvida todo el contexto. */
  reiniciar(): void
  /** Prepara lo necesario para que el primer mensaje salga rápido. */
  precalentar?(): void
  /** Cuándo se nota un cambio del marcador de potencia; ausente si este proveedor no tiene niveles. */
  readonly aplicaEsfuerzo?: InfoPotencia['aplica']
  /** Cambia cuánto «piensa» el modelo (el marcador de potencia de la cabecera). */
  establecerEsfuerzo?(nivel: Esfuerzo): void
  cerrar(): void
}

export type Esfuerzo = NivelEsfuerzo
