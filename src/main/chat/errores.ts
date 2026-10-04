import Anthropic, { type APIError } from '@anthropic-ai/sdk'
import type { CodigoError, ErrorOrbe } from '../../shared/tipos'

/** Error de chat ya traducido: lo lanzan los proveedores y el servicio lo convierte en un evento. */
export class ErrorChat extends Error {
  constructor(readonly error: ErrorOrbe) {
    super(error.mensaje)
    this.name = 'ErrorChat'
  }
}

interface Plantilla {
  titulo: string
  mensaje: string
  reintentable: boolean
}

const PLANTILLAS: Record<CodigoError, Plantilla> = {
  sin_conexion: {
    titulo: 'Sin conexión',
    mensaje: 'No consigo conectar con Claude. Revisa tu conexión a internet e inténtalo de nuevo.',
    reintentable: true
  },
  clave_invalida: {
    titulo: 'API key no válida',
    mensaje: 'Claude ha rechazado la API key. Revisa ANTHROPIC_API_KEY en el archivo .env.',
    reintentable: false
  },
  sin_sesion: {
    titulo: 'Sesión de Claude no iniciada',
    mensaje:
      'No has iniciado sesión en Claude. Abre una terminal, ejecuta «claude», escribe /login y vuelve a intentarlo.',
    reintentable: true
  },
  limite_uso: {
    titulo: 'Límite de uso alcanzado',
    mensaje: 'Has alcanzado el límite de uso. Espera un poco y vuelve a intentarlo.',
    reintentable: true
  },
  sobrecarga: {
    titulo: 'Claude está saturado',
    mensaje: 'Los servidores de Claude están saturados en este momento. Inténtalo de nuevo en unos instantes.',
    reintentable: true
  },
  cli_no_encontrado: {
    titulo: 'No encuentro el CLI de Claude',
    mensaje:
      'No encuentro «claude». Instálalo con «npm install -g @anthropic-ai/claude-code» o indica su ruta en CLAUDE_CLI_PATH dentro de .env.',
    reintentable: true
  },
  cuenta: {
    titulo: 'Problema con la cuenta',
    mensaje: 'Tu cuenta no puede usar Claude ahora mismo. Revisa tu plan, tu facturación o tus permisos.',
    reintentable: false
  },
  modelo: {
    titulo: 'Modelo no disponible',
    mensaje: 'El modelo configurado no existe o no está disponible para tu cuenta. Revisa ORBE_MODELO en .env.',
    reintentable: false
  },
  rechazo: {
    titulo: 'Claude no puede responder a esto',
    mensaje: 'Claude ha declinado responder a esta petición.',
    reintentable: false
  },
  solicitud_invalida: {
    titulo: 'Petición no válida',
    mensaje: 'Claude no ha aceptado la petición.',
    reintentable: false
  },
  tiempo_agotado: {
    titulo: 'Claude no responde',
    mensaje: 'Claude ha tardado demasiado en responder. Inténtalo de nuevo.',
    reintentable: true
  },
  lector_no_disponible: {
    titulo: 'No puedo leer la pantalla',
    mensaje:
      'El lector de pantalla de Windows no está disponible. Reinicia Orbe y, si sigue igual, mira los detalles técnicos.',
    reintentable: true
  },
  sin_ventana: {
    titulo: 'No hay nada que leer',
    mensaje:
      'No encuentro ninguna ventana que leer. Pon en primer plano la aplicación que quieres que mire y vuelve a pulsar el botón.',
    reintentable: true
  },
  captura_no_disponible: {
    titulo: 'No he podido hacer la captura',
    mensaje: 'Windows no me ha dejado capturar la pantalla. Inténtalo de nuevo; si sigue igual, mira los detalles técnicos.',
    reintentable: true
  },
  desconocido: {
    titulo: 'Algo ha fallado',
    mensaje: 'Ha ocurrido un error inesperado al hablar con Claude.',
    reintentable: true
  }
}

/** Convierte cualquier cosa lanzada por un proveedor o servicio en un error para el usuario. */
export function aErrorOrbe(e: unknown): ErrorOrbe {
  if (e instanceof ErrorChat) return e.error
  return errorDesdeApi(e)
}

export function crearError(
  codigo: CodigoError,
  extra: { mensaje?: string; detalle?: string; reintentable?: boolean } = {}
): ErrorOrbe {
  const base = PLANTILLAS[codigo]
  return {
    codigo,
    titulo: base.titulo,
    mensaje: extra.mensaje ?? base.mensaje,
    reintentable: extra.reintentable ?? base.reintentable,
    ...(extra.detalle ? { detalle: extra.detalle } : {})
  }
}

/** «a las 15:30» si es hoy; «el jueves a las 09:00» si es otro día. Admite zona horaria para las pruebas. */
export function describirReinicio(epochSegundos: number, ahora: Date = new Date(), zonaHoraria?: string): string {
  const instante = new Date(epochSegundos * 1000)
  const opcionesHora: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zonaHoraria }
  const hora = instante.toLocaleTimeString('es-ES', opcionesHora)
  const dia = (d: Date): string => d.toLocaleDateString('es-ES', { timeZone: zonaHoraria })
  if (dia(instante) === dia(ahora)) return `a las ${hora}`
  const diaSemana = instante.toLocaleDateString('es-ES', { weekday: 'long', timeZone: zonaHoraria })
  return `el ${diaSemana} a las ${hora}`
}

// ---------------------------------------------------------------------------------------------
// CLI de Claude
// ---------------------------------------------------------------------------------------------

export interface InfoErrorCli {
  /** Campo `error` del mensaje del asistente: authentication_failed, rate_limit, overloaded… */
  codigoCli?: string | null
  /** Estado HTTP si el CLI lo informa. */
  estadoHttp?: number | null
  texto?: string
  /** Momento en que se restablece el límite (segundos desde epoch), si se conoce. */
  reinicioSeg?: number | null
  /** El último aviso de límites del CLI decía «rejected». */
  limiteRechazado?: boolean
  stderr?: string
}

function detalleCli(info: InfoErrorCli): string | undefined {
  const partes = [
    info.codigoCli ? `error=${info.codigoCli}` : '',
    info.estadoHttp ? `http=${info.estadoHttp}` : '',
    info.texto ? `cli="${info.texto.slice(0, 300)}"` : '',
    info.stderr ? `stderr=${info.stderr.trim().slice(-400)}` : ''
  ].filter(Boolean)
  return partes.length ? partes.join(' · ') : undefined
}

function errorLimite(info: InfoErrorCli, ahora?: Date): ErrorOrbe {
  const detalle = detalleCli(info)
  if (info.reinicioSeg) {
    return crearError('limite_uso', {
      mensaje: `Has alcanzado el límite de uso de tu plan. Se restablece ${describirReinicio(info.reinicioSeg, ahora)}.`,
      detalle
    })
  }
  return crearError('limite_uso', { detalle })
}

/** Traduce lo que cuenta el CLI de Claude (campo `error`, estado HTTP, texto) a un error para el usuario. */
export function errorDesdeCli(info: InfoErrorCli, ahora?: Date): ErrorOrbe {
  const detalle = detalleCli(info)

  switch (info.codigoCli) {
    case 'authentication_failed':
      return crearError('sin_sesion', { detalle })
    case 'oauth_org_not_allowed':
      return crearError('cuenta', {
        mensaje: 'Tu organización no permite usar esta cuenta de Claude con el CLI. Consulta con tu administrador.',
        detalle
      })
    case 'account_on_hold':
    case 'verification_required':
    case 'billing_error':
    case 'cloud_credential_error':
      return crearError('cuenta', {
        mensaje: info.texto ? `Problema con tu cuenta de Claude: ${info.texto}` : undefined,
        detalle
      })
    case 'rate_limit':
      return errorLimite(info, ahora)
    case 'overloaded':
      return crearError('sobrecarga', { detalle })
    case 'server_error':
      return crearError('sobrecarga', {
        mensaje: 'Claude está teniendo problemas en sus servidores. Inténtalo de nuevo en un momento.',
        detalle
      })
    case 'invalid_request':
      return crearError('solicitud_invalida', {
        mensaje: info.texto ? `Claude no ha aceptado la petición: ${info.texto}` : undefined,
        detalle
      })
    case 'model_not_found':
      return crearError('modelo', { detalle })
  }

  switch (info.estadoHttp) {
    case 401:
      return crearError('sin_sesion', { detalle })
    case 402:
    case 403:
      return crearError('cuenta', { detalle })
    case 404:
      return crearError('modelo', { detalle })
    case 429:
      return errorLimite(info, ahora)
    case 400:
      return crearError('solicitud_invalida', { detalle })
  }
  if (info.estadoHttp && info.estadoHttp >= 500) return crearError('sobrecarga', { detalle })

  if (info.limiteRechazado) return errorLimite(info, ahora)

  return crearError('desconocido', {
    mensaje: info.texto ? `Claude ha devuelto un error: ${info.texto}` : undefined,
    detalle
  })
}

// ---------------------------------------------------------------------------------------------
// SDK de Anthropic
// ---------------------------------------------------------------------------------------------

/** Segundos que indica la cabecera `retry-after`, si viene. */
function reintentoSegundos(e: APIError): number | null {
  const valor = e.headers?.get?.('retry-after')
  const n = valor ? Number(valor) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Traduce una excepción del SDK (clases tipadas, de la más específica a la más general). */
export function errorDesdeApi(e: unknown): ErrorOrbe {
  if (e instanceof ErrorChat) return e.error

  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return crearError('tiempo_agotado', { detalle: e.message })
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return crearError('sin_conexion', { detalle: e.message })
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return crearError('clave_invalida', { detalle: `http=${e.status}` })
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return crearError('cuenta', {
      mensaje: 'Tu API key no tiene permiso para esta operación (403). Revisa los permisos de la clave o del modelo.',
      detalle: `http=${e.status} ${e.message}`
    })
  }
  if (e instanceof Anthropic.NotFoundError) {
    return crearError('modelo', { detalle: `http=${e.status} ${e.message}` })
  }
  if (e instanceof Anthropic.RateLimitError) {
    const espera = reintentoSegundos(e)
    return crearError('limite_uso', {
      mensaje: espera
        ? `Has alcanzado el límite de uso de la API. Vuelve a intentarlo en unos ${Math.ceil(espera)} segundos.`
        : undefined,
      detalle: `http=${e.status}`
    })
  }
  if (e instanceof Anthropic.BadRequestError) {
    return crearError('solicitud_invalida', {
      mensaje: `Claude no ha aceptado la petición: ${e.message}`,
      detalle: `http=${e.status}`
    })
  }
  if (e instanceof Anthropic.InternalServerError) {
    return crearError('sobrecarga', {
      mensaje:
        e.status === 529
          ? undefined
          : 'Claude está teniendo problemas en sus servidores. Inténtalo de nuevo en un momento.',
      detalle: `http=${e.status}`
    })
  }
  if (e instanceof Anthropic.APIError) {
    if (e.status === 402) return crearError('cuenta', { detalle: `http=${e.status} ${e.message}` })
    return crearError('desconocido', {
      mensaje: `Claude ha devuelto un error${e.status ? ` (${e.status})` : ''}: ${e.message}`,
      detalle: e.message
    })
  }
  return crearError('desconocido', { detalle: e instanceof Error ? e.message : String(e) })
}
