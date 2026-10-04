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
  chatEvento: 'chat:evento',
  pantallaLeer: 'pantalla:leer',
  pantallaQuitar: 'pantalla:quitar',
  pantallaDescartar: 'pantalla:descartar',
  pantallaEvento: 'pantalla:evento'
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
  | 'lector_no_disponible'
  | 'sin_ventana'
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
  /** Adjuntar el contexto de pantalla que el usuario ya pidió leer (nunca se lee por su cuenta). */
  conContexto?: boolean
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
  seleccionRecortada?: boolean
  ventana?: { aplicacion: string; titulo: string; url?: string }
  /** Contenido de la ventana activa leído por UI Automation, ya limpio y recortado. */
  contenido?: string
  contenidoRecortado?: boolean
  imagen?: { tipoMime: 'image/jpeg' | 'image/png'; base64: string; ancho: number; alto: number }
}

export type ClaveParte = 'ventana' | 'seleccion' | 'contenido' | 'imagen'

/** Lo que se muestra de cada trozo de contexto (chips): etiqueta, resumen y una vista previa del texto. */
export interface ParteContexto {
  clave: ClaveParte
  etiqueta: string
  resumen: string
  /** Vista previa recortada de lo que se envía (o se enviará) al modelo. */
  vista: string
  caracteres?: number
  recortado?: boolean
}

export interface LecturaPantalla {
  partes: ParteContexto[]
  avisos: string[]
  /** Hay poco texto útil: una captura podría ayudar (fase 4). */
  sugerirCaptura: boolean
}

export type RespuestaLectura = ({ ok: true } & LecturaPantalla) | { ok: false; error: ErrorOrbe }

export type EventoPantalla =
  /** Se está leyendo la pantalla (para animar el orbe aunque el panel esté cerrado). */
  | { tipo: 'leyendo'; activo: boolean }
  /** Hay un contexto listo para adjuntar al próximo mensaje (o ha cambiado). */
  | { tipo: 'pendiente'; lectura: LecturaPantalla; origen: 'atajo' | 'boton' | 'restaurado' }
  /** El contexto pendiente se descartó (caducó o se envió). */
  | { tipo: 'vacio'; motivo: 'caducado' | 'descartado' | 'enviado' }
  | { tipo: 'error'; error: ErrorOrbe }

export type ResultadoEnvio = { ok: true; adjuntos: ParteContexto[] } | { ok: false; error: ErrorOrbe }

export interface ApiOrbe {
  alternar(): void
  arrastreInicio(x: number, y: number): void
  arrastreMover(x: number, y: number): void
  arrastreFin(): void
  alCambiarExpandido(cb: (estado: EstadoVentana) => void): () => void
  alCambiarVisibilidad(cb: (visible: boolean) => void): () => void
  abrirEnlace(url: string): void

  chatInfo(): Promise<InfoChat>
  chatEnviar(peticion: PeticionChat): Promise<ResultadoEnvio>
  chatCancelar(id: string): void
  chatNueva(): Promise<void>
  chatPrecalentar(): void
  alEventoChat(cb: (evento: EventoChat) => void): () => void

  pantallaLeer(): Promise<RespuestaLectura>
  pantallaQuitar(clave: ClaveParte): Promise<LecturaPantalla | null>
  pantallaDescartar(): void
  alEventoPantalla(cb: (evento: EventoPantalla) => void): () => void
}
