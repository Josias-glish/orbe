/** Tipos y canales compartidos entre el proceso principal, el preload y la interfaz. */

export type EstadoOrbe = 'reposo' | 'leyendo' | 'pensando' | 'respondiendo' | 'escuchando' | 'actuando'

/** Cuánto «piensa» el modelo antes de contestar: más nivel, respuestas más cuidadas pero más lentas y más caras. */
export const NIVELES_ESFUERZO = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type NivelEsfuerzo = (typeof NIVELES_ESFUERZO)[number]

export const CANALES = {
  alternar: 'ventana:alternar',
  arrastreInicio: 'ventana:arrastre-inicio',
  arrastreMover: 'ventana:arrastre-mover',
  arrastreFin: 'ventana:arrastre-fin',
  redimensionarInicio: 'ventana:redimensionar-inicio',
  redimensionarMover: 'ventana:redimensionar-mover',
  redimensionarFin: 'ventana:redimensionar-fin',
  expandidoCambio: 'ventana:expandido-cambio',
  visibilidad: 'ventana:visibilidad',
  abrirEnlace: 'app:abrir-enlace',
  chatEnviar: 'chat:enviar',
  chatCancelar: 'chat:cancelar',
  chatNueva: 'chat:nueva',
  chatInfo: 'chat:info',
  chatPrecalentar: 'chat:precalentar',
  chatEvento: 'chat:evento',
  chatConfirmar: 'chat:confirmar',
  potenciaInfo: 'potencia:info',
  potenciaFijar: 'potencia:fijar',
  pantallaLeer: 'pantalla:leer',
  pantallaQuitar: 'pantalla:quitar',
  pantallaDescartar: 'pantalla:descartar',
  pantallaEvento: 'pantalla:evento',
  pantallaCapturar: 'pantalla:capturar',
  appOrden: 'app:orden',
  appSalir: 'app:salir',
  ventanaFijar: 'ventana:fijar',
  configLeer: 'config:leer',
  configGuardar: 'config:guardar',
  vozInfo: 'voz:info',
  vozTranscribir: 'voz:transcribir',
  vozSintetizar: 'voz:sintetizar',
  fondoEstado: 'fondo:estado',
  fondoSiguiente: 'fondo:siguiente',
  fondoAjustar: 'fondo:ajustar',
  memoriaInicio: 'memoria:inicio',
  memoriaEstado: 'memoria:estado',
  memoriaGuardar: 'memoria:guardar',
  memoriaActualizar: 'memoria:actualizar',
  memoriaBorrar: 'memoria:borrar',
  memoriaImportar: 'memoria:importar',
  memoriaActivar: 'memoria:activar',
  memoriaCarpeta: 'memoria:carpeta',
  memoriaVaciar: 'memoria:vaciar'
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
  | 'captura_no_disponible'
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

export type MotivoFin = 'completo' | 'cancelado' | 'limite_tokens' | 'limite_pasos'

/** En qué punto está una acción del agente: `denegada` es la que la política prohibió o el usuario no permitió. */
export type EstadoAccion = 'en_curso' | 'ok' | 'error' | 'denegada' | 'cancelada'

/** Una acción del agente tal como se enseña en el chat: qué herramienta, con qué parámetros y qué resultó. */
export interface AccionVista {
  /** Identifica la acción: llega dos veces (al empezar y al terminar) con el mismo id. */
  accionId: string
  herramienta: string
  /** Línea compacta, p. ej. «Buscando: tiempo en Lima». */
  titulo: string
  /** Parámetros ya recortados, para el detalle desplegable. */
  parametros: string
  estado: EstadoAccion
  /** Resultado recortado (o el motivo del error o de la negativa). */
  resultado?: string
}

/** Lo que el agente quiere hacer y necesita que el usuario permita: la acción exacta, con Permitir y Cancelar. */
export interface ConfirmacionVista {
  confirmacionId: string
  titulo: string
  detalle: string
  /** Se avisa con más énfasis (p. ej. un archivo ejecutable o una página con instrucciones sospechosas). */
  peligrosa?: boolean
  etiquetaPermitir?: string
  etiquetaCancelar?: string
}

/** De dónde salió parte de una respuesta (una búsqueda web): se enseña como un enlace bajo el texto. */
export interface FuenteVista {
  titulo: string
  /** Siempre http o https: la interfaz la abre en el navegador, nunca dentro de Orbe. */
  url: string
}

export type EventoChat =
  | { tipo: 'inicio'; id: string }
  | { tipo: 'texto'; id: string; delta: string }
  | { tipo: 'reintento'; id: string; intento: number; maximo: number }
  | { tipo: 'aviso'; id: string; texto: string }
  | { tipo: 'accion'; id: string; accion: AccionVista }
  | { tipo: 'confirmar'; id: string; confirmacion: ConfirmacionVista }
  | { tipo: 'fuentes'; id: string; fuentes: FuenteVista[] }
  | { tipo: 'fin'; id: string; motivo: MotivoFin }
  | { tipo: 'error'; id: string; error: ErrorOrbe }

export interface PeticionChat {
  id: string
  texto: string
  /** Adjuntar el contexto de pantalla que el usuario ya pidió leer (nunca se lee por su cuenta). */
  conContexto?: boolean
}

export interface InfoChat {
  proveedor: 'cli' | 'api' | 'openai'
  modelo: string
  /** Nombre legible para la cabecera, p. ej. «Sonnet 5.5». */
  modeloLegible: string
  /** El modo agente (buscar, abrir, navegar) está activo en esta sesión. */
  agente: boolean
}

/** El marcador de potencia de la cabecera: el nivel actual y cuándo se nota un cambio con el proveedor en uso. */
export interface InfoPotencia {
  nivel: NivelEsfuerzo
  /**
   * `ahora`: desde el próximo mensaje. `proxima_conversacion`: el CLI de Claude lo fija al arrancar. `segun_servicio`:
   * un servicio compatible con OpenAI solo lo aplica si su modelo tiene niveles de razonamiento.
   */
  aplica: 'ahora' | 'proxima_conversacion' | 'segun_servicio'
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
  /** Solo en la captura: una versión pequeña de la imagen (data URL) para la vista previa. La imagen entera nunca llega a la interfaz. */
  miniatura?: string
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

export type ResultadoEnvio =
  | { ok: true; adjuntos: ParteContexto[]; memoria?: AvisoMemoria }
  | { ok: false; error: ErrorOrbe }

// ---------------------------------------------------------------------------------------------
// Memoria
// ---------------------------------------------------------------------------------------------

/** Perfil = quién es el usuario; preferencia = cómo quiere que se trabaje; proyecto = en qué anda; nota = lo que él pidió recordar. */
export type TipoMemoria = 'usuario' | 'preferencia' | 'proyecto' | 'nota'

export interface RecuerdoVista {
  id: string
  tipo: TipoMemoria
  /** Resumen de una línea. */
  titulo: string
  cuerpo: string
  /** Lo trajo la importación desde la memoria de Claude, o lo escribió el usuario. */
  origen: 'claude' | 'usuario'
  /** Se incluye en lo que Orbe sabe del usuario. */
  usar: boolean
  /** Se envía el texto completo; si no, solo el resumen. */
  completo: boolean
  /** Cuánto ocupa en el prompt con su modo actual (0 si no se usa o no cabe). */
  caracteres: number
  modificado: string
}

export interface EstadoMemoria {
  activa: boolean
  recuerdos: RecuerdoVista[]
  presupuesto: { usados: number; max: number; omitidos: number }
  carpeta: string
  hayConversacion: boolean
}

export interface InformeImportacion {
  nuevas: number
  actualizadas: number
  sinCambios: number
  omitidas: Array<{ nombre: string; motivo: string }>
  /** Carpetas de memoria de Claude que se encontraron. */
  fuentes: number
}

/** `sensible` indica que se rechazó por parecer una clave o dato personal delicado (se puede forzar). */
export type ResultadoMemoria = { ok: true; estado: EstadoMemoria; id?: string } | { ok: false; error: string; sensible?: boolean }

/** Qué pasó cuando el mensaje era una orden tipo «recuerda que…». */
export type AvisoMemoria = { tipo: 'guardado'; id: string; texto: string } | { tipo: 'no_guardado'; motivo: string }

export interface MensajeGuardado {
  rol: 'usuario' | 'asistente'
  texto: string
}

export interface InicioMemoria {
  /** La conversación que quedó guardada la última vez (vacía si no hay o la memoria está apagada). */
  mensajes: MensajeGuardado[]
  /** Aviso de una sola vez tras la primera importación de la memoria de Claude. */
  bienvenida: string | null
}

export interface CambiosRecuerdo {
  titulo?: string
  cuerpo?: string
  usar?: boolean
  completo?: boolean
}

/** Lo que la interfaz sabe del dictado por micrófono (nunca la clave). */
export interface InfoVoz {
  /** Hay un servicio de transcripción configurado. */
  dictado: boolean
  modelo: string
  idioma: string
  /** Hay un servicio de voz neuronal configurado (para leer las respuestas con una voz más natural). */
  neuronal: boolean
  /** Nombre de la voz neuronal (p. ej. «onyx»). */
  vozNeuronal: string
}

export type ResultadoSintesis = { ok: true; audio: Uint8Array; mime: string } | { ok: false; error: ErrorOrbe }

export type ResultadoDictado = { ok: true; texto: string } | { ok: false; error: ErrorOrbe }

/** El fondo del chat: una imagen de la carpeta que el usuario eligió, con su visibilidad. */
export interface EstadoFondo {
  /** Hay una carpeta con imágenes. Si no, el menú de fondos no se ofrece. */
  disponible: boolean
  activo: boolean
  /** 0,1–0,9: cuánto se ve la imagen (el resto es un velo oscuro para que el texto se lea). */
  visibilidad: number
  nombre: string | null
  total: number
  /** La imagen ya reducida (data URL). Null si el fondo está apagado o si el estado no la trae (al mover la visibilidad). */
  imagen: string | null
}

/** La configuración que enseña la pantalla de ajustes: los valores del .env y qué claves existen, nunca las claves. */
export interface ConfigVista {
  proveedor: 'cli' | 'api' | 'openai'
  modelo: string
  openaiUrl: string
  tieneClaveOpenai: boolean
  tieneClaveAnthropic: boolean
  dictado: { url: string; modelo: string; idioma: string; tieneClave: boolean }
  voz: { url: string; modelo: string; voz: string; tieneClave: boolean }
}

/** Una clave nueva (texto), mantener la que hay (undefined o vacía) o quitarla (null). */
export type ClaveNueva = string | null | undefined

export interface PeticionConfig {
  proveedor: 'cli' | 'api' | 'openai'
  modelo: string
  openaiUrl: string
  openaiKey: ClaveNueva
  anthropicKey: ClaveNueva
  dictado: { url: string; modelo: string; idioma: string; clave: ClaveNueva }
  voz: { url: string; modelo: string; voz: string; clave: ClaveNueva }
}

export type ResultadoConfig = { ok: true } | { ok: false; error: string }

/** Órdenes que el proceso principal (la bandeja) da a la interfaz. */
export type OrdenApp = 'nueva-conversacion'

export interface ApiOrbe {
  alternar(): void
  arrastreInicio(x: number, y: number): void
  arrastreMover(x: number, y: number): void
  arrastreFin(): void
  /** Cambiar el tamaño del panel arrastrando un borde (x, y: coordenadas de pantalla; modo: qué ejes). */
  redimensionarInicio(x: number, y: number, modo: 'x' | 'y' | 'xy'): void
  redimensionarMover(x: number, y: number): void
  redimensionarFin(): void
  alCambiarExpandido(cb: (estado: EstadoVentana) => void): () => void
  alCambiarVisibilidad(cb: (visible: boolean) => void): () => void
  abrirEnlace(url: string): void

  chatInfo(): Promise<InfoChat>
  chatEnviar(peticion: PeticionChat): Promise<ResultadoEnvio>
  chatCancelar(id: string): void
  /** Responde a una confirmación del agente (Permitir o Cancelar). */
  chatConfirmar(id: string, confirmacionId: string, permitir: boolean): void
  chatNueva(): Promise<void>
  /** El marcador de potencia: el nivel actual del modelo y cuándo se aplica un cambio. */
  potenciaInfo(): Promise<InfoPotencia>
  potenciaFijar(nivel: NivelEsfuerzo): Promise<InfoPotencia>
  chatPrecalentar(): void
  alEventoChat(cb: (evento: EventoChat) => void): () => void

  pantallaLeer(): Promise<RespuestaLectura>
  pantallaQuitar(clave: ClaveParte): Promise<LecturaPantalla | null>
  pantallaDescartar(): void
  /** Captura de respaldo: oculta Orbe, fotografía la pantalla y deja la imagen lista para el próximo mensaje. Solo tras la confirmación del usuario. */
  pantallaCapturar(): Promise<RespuestaLectura>
  alEventoPantalla(cb: (evento: EventoPantalla) => void): () => void
  alOrdenApp(cb: (orden: OrdenApp) => void): () => void
  /** Fija el panel por encima de las demás ventanas (o lo suelta). Sin argumento, solo dice cómo está. */
  fijarPanel(fijar?: boolean): Promise<boolean>
  salirDeOrbe(): Promise<void>
  configLeer(): Promise<ConfigVista>
  configGuardar(peticion: PeticionConfig): Promise<ResultadoConfig>

  vozInfo(): Promise<InfoVoz>
  /** Pasa a texto una grabación del micrófono (solo tras pulsar grabar y terminar). */
  vozTranscribir(audio: Uint8Array, mime: string): Promise<ResultadoDictado>
  /** Convierte una frase en audio con la voz neuronal configurada (solo si el usuario la eligió en el menú de voz). */
  vozSintetizar(texto: string): Promise<ResultadoSintesis>

  fondoEstado(): Promise<EstadoFondo>
  fondoSiguiente(): Promise<EstadoFondo>
  fondoAjustar(cambios: { activo?: boolean; visibilidad?: number }): Promise<EstadoFondo>

  memoriaInicio(): Promise<InicioMemoria>
  memoriaEstado(): Promise<EstadoMemoria>
  memoriaGuardar(texto: string, forzar?: boolean): Promise<ResultadoMemoria>
  memoriaActualizar(id: string, cambios: CambiosRecuerdo, forzar?: boolean): Promise<ResultadoMemoria>
  memoriaBorrar(id: string): Promise<ResultadoMemoria>
  memoriaImportar(): Promise<{ informe: InformeImportacion; estado: EstadoMemoria }>
  memoriaActivar(activa: boolean): Promise<ResultadoMemoria>
  memoriaCarpeta(): void
  memoriaVaciar(): Promise<ResultadoMemoria>
}
