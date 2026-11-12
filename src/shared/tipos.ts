import type { ConfigIdentidad } from './identidad'
import type { EstadoCofre, ResultadoCofre } from './cofre'
/** Tipos y canales compartidos entre el proceso principal, el preload y la interfaz. */

export type EstadoOrbe = 'reposo' | 'leyendo' | 'pensando' | 'respondiendo' | 'escuchando' | 'actuando'

/** Cuánto «piensa» el modelo antes de contestar: más nivel, respuestas más cuidadas pero más lentas y más caras. */
export const NIVELES_ESFUERZO = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type NivelEsfuerzo = (typeof NIVELES_ESFUERZO)[number]

export const CANALES = {
  alternar: 'ventana:alternar',
  ratonInteractivo: 'ventana:raton-interactivo',
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
  pantallaTextoImagen: 'pantalla:texto-imagen',
  pantallaFormula: 'pantalla:formula',
  personajeRecursos: 'personaje:recursos',
  personajeCursor: 'personaje:cursor',
  personajeEntorno: 'personaje:entorno',
  actividadEvento: 'actividad:evento',
  actividadHistorial: 'actividad:historial',
  configElegirRive: 'config:elegir-rive',
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
  fondoElegir: 'fondo:elegir',
  memoriaInicio: 'memoria:inicio',
  memoriaEstado: 'memoria:estado',
  memoriaGuardar: 'memoria:guardar',
  memoriaActualizar: 'memoria:actualizar',
  memoriaBorrar: 'memoria:borrar',
  memoriaImportar: 'memoria:importar',
  memoriaActivar: 'memoria:activar',
  memoriaCarpeta: 'memoria:carpeta',
  memoriaVaciar: 'memoria:vaciar',
  usoResumen: 'uso:resumen',
  usoBorrar: 'uso:borrar',
  usoCambio: 'uso:cambio',
  tareasEstado: 'tareas:estado',
  tareasGuardar: 'tareas:guardar',
  tareasBorrar: 'tareas:borrar',
  tareasEjecutar: 'tareas:ejecutar',
  tareasCancelar: 'tareas:cancelar',
  tareasResponder: 'tareas:responder',
  tareasCambio: 'tareas:cambio',
  // El cofre no tiene canal de lectura de valores: solo estado (booleanos), guardar y borrar.
  cofreEstado: 'cofre:estado',
  cofreGuardar: 'cofre:guardar',
  cofreBorrar: 'cofre:borrar',
  // Gmail: abre el navegador para dar permiso; el permiso va del proceso principal al cofre, nunca a la interfaz.
  gmailConectar: 'gmail:conectar',
  gmailCancelar: 'gmail:cancelar',
  // Contenido: piezas para Instagram que se preparan en local (nada sale del equipo en esta etapa).
  // Métricas de Instagram (solo lectura).
  metricasLeer: 'metricas:leer'
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
  | 'ocr_no_disponible'
  | 'ocr_sin_imagen'
  | 'ocr_sin_texto'
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
  /** Quién habla (Orbe o una identidad propia como Atlas), con su nombre y cómo trata al usuario. */
  identidad: ConfigIdentidad
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
  imagen?: {
    tipoMime: 'image/jpeg' | 'image/png'
    base64: string
    ancho: number
    alto: number
    /** «formula»: una imagen elegida para reconocer y resolver una fórmula o una estructura química (no es un pantallazo). */
    proposito?: 'captura' | 'formula'
  }
  /** Texto reconocido en una imagen (OCR de Windows, en el propio equipo): solo viaja el texto, nunca la imagen. */
  textoImagen?: string
  textoImagenRecortado?: boolean
  textoImagenOrigen?: OrigenTextoImagen
}

/** De dónde sale la imagen cuyo texto se reconoce: la ventana que estabas usando, el portapapeles o un archivo. */
export type OrigenTextoImagen = 'ventana' | 'portapapeles' | 'archivo'

export type ClaveParte = 'ventana' | 'seleccion' | 'contenido' | 'imagen' | 'texto_imagen'

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
/** Lo que pasa en el equipo y a lo que reacciona el personaje. */
export type EventoEntorno = 'ausente' | 'vuelve' | 'bloqueo' | 'desbloqueo' | 'suspension' | 'reanudacion' | 'bateria' | 'corriente'

/** Qué figura vive en la esquina: el personaje 3D (por defecto), el dibujado, el orbe clásico o uno de Rive. */
export type Apariencia = '3d' | 'personaje' | 'orbe' | 'rive'

/**
 * Cómo encaja Orbe con un modelo 3D concreto: dónde están los cristales de las gafas (relativo a la silueta: x desde
 * el centro, y desde arriba, en fracciones del ancho y del alto), qué parte se encuadra y si hay que girarlo.
 */
export interface CalibracionModelo {
  lentes: { x: number; y: number; ancho: number; alto: number }
  encuadre: { arriba: number; abajo: number }
  giro: { y: number; x: number }
  /** Altura del cuello (fracción desde abajo): por debajo es ropa, por encima pelo. */
  cuello?: number
}

/** Lo que necesita la interfaz para montar la figura. Con Rive, el archivo y el motor llegan del proceso principal. */
export interface RecursosPersonaje {
  apariencia: Apariencia
  /** Id del diseño del personaje dibujado (ver DISENOS). */
  diseno: string
  rive?: { archivo: Uint8Array; wasm: Uint8Array; maquina: string | null }
  /** El personaje 3D: el GLB y su calibración (si el modelo trae una). */
  modelo3d?: {
    glb: Uint8Array
    calibracion?: Partial<CalibracionModelo>
    /** Texturas de detalle (gris, repetibles) que se aplican encima: pelo en la cabeza y punto en la ropa. */
    detalles?: { pelo?: Uint8Array; tejido?: Uint8Array }
  }
  /** Si se pidió Rive y no se pudo cargar, por qué (la interfaz usa el personaje dibujado). */
  aviso?: string
}

// ---------------------------------------------------------------------------------------------
// Actividad (conectores): lo que hacen otras herramientas, para verlo en el personaje
// ---------------------------------------------------------------------------------------------

/** Empieza algo, está trabajando, te necesita, terminó, falló o simplemente avisa. */
export type TipoActividad = 'inicio' | 'trabajando' | 'esperando' | 'terminado' | 'error' | 'info'

export interface EventoActividad {
  id: string
  /** Quién lo manda: «claude-code», «n8n», «copia-de-seguridad»… */
  origen: string
  tipo: TipoActividad
  titulo: string
  detalle?: string
  /** Expresión que pide el conector (si no, se elige por el tipo). */
  expresion?: string
  /** Milisegundos desde 1970. */
  cuando: number
}

/** Cuándo se repite una tarea. Las horas son locales («08:30»). */
export type ProgramaTarea =
  | { tipo: 'ahora' }
  | { tipo: 'una-vez'; en: number }
  | { tipo: 'diaria'; hora: string }
  /** 0 = domingo … 6 = sábado. */
  | { tipo: 'semanal'; dias: number[]; hora: string }
  | { tipo: 'cada'; minutos: number }

export type EstadoEjecucion = 'en-curso' | 'esperando' | 'completada' | 'nada-nuevo' | 'error' | 'cancelada'

export interface EjecucionTarea {
  id: string
  inicio: number
  fin: number | null
  estado: EstadoEjecucion
  /** Lo que respondió el agente (recortado). */
  resultado: string
  /** Lo que va haciendo (la última acción), mientras está en curso. */
  paso?: string
  /** Una acción que espera tu permiso. */
  permiso?: { confirmacionId: string; titulo: string; detalle: string; peligrosa: boolean }
}

/** Una tarea de fondo al estilo de los agentes «siempre encendidos»: una instrucción que Orbe hace solo cuando toca. */
export interface TareaVista {
  id: string
  titulo: string
  instruccion: string
  programa: ProgramaTarea
  activa: boolean
  /** Solo avisar si el resultado trae algo nuevo o importante (si no, queda como «nada nuevo» sin molestar). */
  soloSiHayAlgo: boolean
  creada: number
  /** Próxima vez que se hará (ms) o null si ya no toca más. */
  proxima: number | null
  ultima: EjecucionTarea | null
  /** Las últimas ejecuciones, de la más reciente a la más antigua. */
  historial: EjecucionTarea[]
}

export interface EstadoTareas {
  tareas: TareaVista[]
  /** Hay un modelo configurado capaz de hacer tareas (si no, se explica por qué). */
  disponible: boolean
  motivo?: string
}

/** Lo que el usuario escribe al crear o editar una tarea. */
export interface TareaNueva {
  id?: string
  titulo: string
  instruccion: string
  programa: ProgramaTarea
  activa?: boolean
  soloSiHayAlgo?: boolean
}

/** Lo que gastó una llamada al modelo (o un turno entero, en el CLI). */
export interface UsoTokens {
  entrada: number
  salida: number
  /** Tokens leídos de la caché del servicio (más baratos). */
  cacheLectura?: number
  /** Tokens escritos en la caché. */
  cacheEscritura?: number
  /** Coste que da el propio servicio (el CLI de Claude lo da); si falta, Orbe lo estima con su tabla de precios. */
  costeUsd?: number
}

export interface TotalUso {
  entrada: number
  salida: number
  cache: number
  peticiones: number
  /** Dólares (estimados si `estimado`). */
  costeUsd: number
  /** Parte del coste no se conoce (servicios sin tarifa en la tabla): el total puede quedarse corto. */
  sinPrecio: boolean
}

export interface ResumenUso {
  hoy: TotalUso
  semana: TotalUso
  mes: TotalUso
  total: TotalUso
  /** Últimos 14 días, del más antiguo al de hoy (para el gráfico). */
  dias: Array<{ fecha: string; tokens: number; costeUsd: number }>
  /** De qué servicio y modelo vino el gasto (lo de este mes). */
  porModelo: Array<{ proveedor: 'cli' | 'api' | 'openai'; modelo: string } & TotalUso>
  /** Lo último que dijo el CLI de Claude sobre el límite de tu plan (si lo usas). */
  limiteCli: { estado: string; tipo: string | null; reinicio: number | null; cuando: number } | null
  /** Desde cuándo se cuenta (ms desde 1970), o null si aún no hay nada. */
  desde: number | null
}

export interface EstadoActividad {
  /** El receptor local de eventos está encendido (ORBE_EVENTOS=1). */
  activo: boolean
  puerto: number | null
  /** Dónde está el archivo con el puerto y el token que leen los conectores. */
  archivo: string | null
  /** Bloque «hooks» listo para pegar en ~/.claude/settings.json (con la ruta del script de Orbe). */
  configClaudeCode: string
  eventos: EventoActividad[]
}

export interface ConfigVista {
  proveedor: 'cli' | 'api' | 'openai'
  modelo: string
  openaiUrl: string
  tieneClaveOpenai: boolean
  tieneClaveAnthropic: boolean
  dictado: { url: string; modelo: string; idioma: string; tieneClave: boolean }
  voz: { url: string; modelo: string; voz: string; tieneClave: boolean }
  apariencia: Apariencia
  diseno: string
  riveArchivo: string
  eventos: boolean
  identidad: ConfigIdentidad
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
  /** Opcionales: si no vienen, no se tocan. */
  apariencia?: Apariencia
  diseno?: string
  riveArchivo?: string
  eventos?: boolean
  identidad?: ConfigIdentidad
}

export type ResultadoConfig = { ok: true } | { ok: false; error: string }

/** Órdenes que el proceso principal (la bandeja) da a la interfaz. */
export type OrdenApp = 'nueva-conversacion'

export interface ApiOrbe {
  /** El puntero está sobre una zona que debe recibir el ratón (el centro del personaje o el panel abierto). */
  ratonInteractivo(dentro: boolean): void
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
  /**
   * Reconoce el texto de una imagen en el propio equipo (sin pantallazo del monitor, sin ocultar Orbe) y lo deja
   * listo para el próximo mensaje. Solo viaja el texto. Solo cuando el usuario lo pide.
   */
  pantallaTextoImagen(origen: OrigenTextoImagen): Promise<RespuestaLectura>
  /**
   * Prepara una imagen con una fórmula matemática o una estructura química (de la ventana, el portapapeles o un
   * archivo; sin pantallazo del monitor) para que la IA la reconozca y la resuelva. La imagen viaja solo si envías.
   */
  pantallaFormula(origen: OrigenTextoImagen): Promise<RespuestaLectura>
  alEventoPantalla(cb: (evento: EventoPantalla) => void): () => void
  alOrdenApp(cb: (orden: OrdenApp) => void): () => void
  /** Fija el panel por encima de las demás ventanas (o lo suelta). Sin argumento, solo dice cómo está. */
  fijarPanel(fijar?: boolean): Promise<boolean>
  salirDeOrbe(): Promise<void>
  configLeer(): Promise<ConfigVista>
  configGuardar(peticion: PeticionConfig): Promise<ResultadoConfig>
  /** Abre el diálogo para elegir un archivo .riv; devuelve su ruta o null si se cancela. */
  configElegirRive(): Promise<string | null>

  /** La figura de la esquina (y, si es de Rive, su archivo). */
  personajeRecursos(): Promise<RecursosPersonaje>
  /** Dónde está el cursor (coordenadas de pantalla), para que el personaje lo siga con la mirada. */
  alCursor(cb: (punto: { x: number; y: number }) => void): () => void
  /** Lo que pasa en el equipo: te fuiste o volviste, bloqueaste la pantalla, pasó a batería… */
  alEntorno(cb: (evento: EventoEntorno) => void): () => void
  /** Avisos de los conectores (Claude Code y otras herramientas). */
  alActividad(cb: (evento: EventoActividad) => void): () => void
  tareasEstado(): Promise<EstadoTareas>
  tareasGuardar(tarea: TareaNueva): Promise<EstadoTareas>
  tareasBorrar(id: string): Promise<EstadoTareas>
  tareasEjecutar(id: string): Promise<EstadoTareas>
  tareasCancelar(id: string): Promise<EstadoTareas>
  /** Responde a la petición de permiso de una tarea en curso. */
  tareasResponder(id: string, confirmacionId: string, permitir: boolean): Promise<EstadoTareas>
  alTareas(cb: () => void): () => void
  usoResumen(): Promise<ResumenUso>
  usoBorrar(): Promise<ResumenUso>
  /** Avisa cuando cambia el consumo (al terminar cada respuesta). */
  alUso(cb: () => void): () => void
  actividadHistorial(): Promise<EstadoActividad>

  vozInfo(): Promise<InfoVoz>
  /** Pasa a texto una grabación del micrófono (solo tras pulsar grabar y terminar). */
  vozTranscribir(audio: Uint8Array, mime: string): Promise<ResultadoDictado>
  /** Convierte una frase en audio con la voz neuronal configurada (solo si el usuario la eligió en el menú de voz). */
  vozSintetizar(texto: string): Promise<ResultadoSintesis>

  fondoEstado(): Promise<EstadoFondo>
  fondoSiguiente(): Promise<EstadoFondo>
  fondoAjustar(cambios: { activo?: boolean; visibilidad?: number }): Promise<EstadoFondo>
  /** Abre el diálogo del sistema para elegir una imagen; se copia a `%APPDATA%\orbe\fondos`. */
  fondoElegir(): Promise<EstadoFondo>

  memoriaInicio(): Promise<InicioMemoria>
  memoriaEstado(): Promise<EstadoMemoria>
  memoriaGuardar(texto: string, forzar?: boolean): Promise<ResultadoMemoria>
  memoriaActualizar(id: string, cambios: CambiosRecuerdo, forzar?: boolean): Promise<ResultadoMemoria>
  memoriaBorrar(id: string): Promise<ResultadoMemoria>
  memoriaImportar(): Promise<{ informe: InformeImportacion; estado: EstadoMemoria }>
  memoriaActivar(activa: boolean): Promise<ResultadoMemoria>
  memoriaCarpeta(): void
  memoriaVaciar(): Promise<ResultadoMemoria>

  /** Qué secretos hay guardados en el cofre (solo sí o no, nunca el valor). */
  cofreEstado(): Promise<EstadoCofre>
  /** Guarda un secreto de la lista `SECRETOS`; el valor viaja una sola vez hacia el proceso principal. */
  cofreGuardar(clave: string, valor: string): Promise<ResultadoCofre>
  cofreBorrar(clave: string): Promise<ResultadoCofre>
  /** Conecta Gmail con OAuth en el navegador (puede tardar: espera a que termines en Google). */
  gmailConectar(): Promise<ResultadoCofre>
  /** Deja de esperar al navegador (la conexión en curso termina con «Conexión cancelada»). */
  gmailCancelar(): void

  /** Métricas de una cuenta. Sin `actualizar`, lo último leído (si lo hay) sin llamar a Instagram. */
  metricasLeer(cuenta: CuentaIg, actualizar: boolean): Promise<ResultadoMetricas>
}

// ---------------------------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------------------------

export interface DiaMetricas {
  /** AAAA-MM-DD (día local). */
  fecha: string
  seguidores: number
  alcanceMedio?: number
}

export interface PublicacionMetricas {
  id: string
  tipo: string
  fecha: string
  enlace: string
  pie: string
  meGusta: number
  comentarios: number
  visualizaciones?: number
  alcance?: number
  compartidos?: number
  guardados?: number
  interacciones?: number
  /** Interacciones sobre alcance (o sobre seguidores si no hay alcance), en %. */
  tasa?: number
}

export interface InformeMetricas {
  cuenta: CuentaIg
  leido: number
  usuario: string
  seguidores: number
  numPublicaciones: number
  publicaciones: PublicacionMetricas[]
  medias: { alcance: number | null; interacciones: number | null; tasa: number | null }
  /** Seguidores ganados (o perdidos) en 7 y 30 días según el historial guardado; `null` sin datos suficientes. */
  crecimiento: { dias7: number | null; dias30: number | null }
  historial: DiaMetricas[]
  /** Por qué faltan las métricas detalladas (p. ej., falta el permiso de estadísticas). */
  avisoMetricas?: string
}

export type ResultadoMetricas = { ok: true; informe: InformeMetricas } | { ok: false; error: string; informe: InformeMetricas | null }

/** Las cuentas de Instagram del usuario. */
export type CuentaIg = 'morfy' | 'personal'

