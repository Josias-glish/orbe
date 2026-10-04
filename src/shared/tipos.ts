/** Tipos y canales compartidos entre el proceso principal, el preload y la interfaz. */

export type EstadoOrbe = 'reposo' | 'leyendo' | 'pensando' | 'respondiendo' | 'escuchando'

export const CANALES = {
  alternar: 'ventana:alternar',
  arrastreInicio: 'ventana:arrastre-inicio',
  arrastreMover: 'ventana:arrastre-mover',
  arrastreFin: 'ventana:arrastre-fin',
  expandidoCambio: 'ventana:expandido-cambio',
  visibilidad: 'ventana:visibilidad',
  abrirEnlace: 'app:abrir-enlace',
  chatEnviar: 'chat:enviar',
  chatCancelar: 'chat:cancelar',
  chatNueva: 'chat:nueva',
  chatInfo: 'chat:info',
  chatPrecalentar: 'chat:precalentar',
  chatEvento: 'chat:evento'
} as const

export interface EstadoVentana {
  expandido: boolean
  /** Hacia dónde crece el panel respecto al orbe, para anclar el diseño. */
  ancla: { horizontal: 'izquierda' | 'derecha'; vertical: 'arriba' | 'abajo' }
}

// ---------------------------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------------------------

export type CodigoError =
  | 'sin_conexion'
  | 'clave_invalida'
  | 'sin_sesion'
  | 'limite_uso'
  | 'sobrecarga'
  | 'cli_no_encontrado'
  | 'cuenta'
  | 'modelo'
  | 'rechazo'
  | 'solicitud_invalida'
  | 'tiempo_agotado'
  | 'desconocido'

/** Error ya traducido a algo que se le puede mostrar al usuario. */
export interface ErrorOrbe {
  codigo: CodigoError
  titulo: string
  mensaje: string
  /** Tiene sentido ofrecer un botón «Reintentar». */
  reintentable: boolean
  /** Texto técnico (código de estado, stderr…) para quien quiera investigar. */
  detalle?: string
}

export type MotivoFin = 'completo' | 'cancelado' | 'limite_tokens'

export type EventoChat =
  | { tipo: 'inicio'; id: string }
  | { tipo: 'texto'; id: string; delta: string }
  | { tipo: 'reintento'; id: string; intento: number; maximo: number }
  | { tipo: 'aviso'; id: string; texto: string }
  | { tipo: 'fin'; id: string; motivo: MotivoFin }
  | { tipo: 'error'; id: string; error: ErrorOrbe }

export interface PeticionChat {
  id: string
  texto: string
}

export interface InfoChat {
  proveedor: 'cli' | 'api'
  modelo: string
  /** Nombre legible para la cabecera, p. ej. «Sonnet 5.5». */
  modeloLegible: string
}

/** Lo que Orbe sabe de la pantalla; se rellena en las fases 3 y 4 y nunca sin que el usuario lo pida. */
export interface ContextoPantalla {
  /** Texto que el usuario tenía seleccionado. */
  seleccion?: string
  ventana?: { aplicacion: string; titulo: string; url?: string }
  /** Contenido de la ventana activa leído por UI Automation, ya limpio y recortado. */
  contenido?: string
  imagen?: { tipoMime: 'image/jpeg' | 'image/png'; base64: string; ancho: number; alto: number }
}

export interface ApiOrbe {
  alternar(): void
  arrastreInicio(x: number, y: number): void
  arrastreMover(x: number, y: number): void
  arrastreFin(): void
  alCambiarExpandido(cb: (estado: EstadoVentana) => void): () => void
  alCambiarVisibilidad(cb: (visible: boolean) => void): () => void
  abrirEnlace(url: string): void

  chatInfo(): Promise<InfoChat>
  chatEnviar(peticion: PeticionChat): Promise<{ ok: true } | { ok: false; error: ErrorOrbe }>
  chatCancelar(id: string): void
  chatNueva(): Promise<void>
  chatPrecalentar(): void
  alEventoChat(cb: (evento: EventoChat) => void): () => void
}
