import Anthropic from '@anthropic-ai/sdk'
import type { MotivoFin } from '../../shared/tipos'
import { ejecutarBucle, type RespuestaPaso } from '../agente/bucle'
import { agenteActivo, crearEjecutor, hayBusquedaWeb, type OpcionesAgente } from '../agente/sesion'
import type { LlamadaHerramienta, ResultadoLlamada } from '../agente/tipos'
import {
  SeguimientoBusquedas,
  definicionBusquedaNativa,
  esBusquedaNoDisponible,
  fuentesDeContenido,
  quitarBloquesIncompletos
} from './busqueda-nativa'
import { construirBloques, type TurnoEntrada } from './contenido'
import { ErrorChat, crearError, errorDesdeApi } from './errores'
import { construirPromptSistema } from './prompt-sistema'
import type { Esfuerzo, ManejadoresTurno, ProveedorChat, ResultadoTurno } from './proveedor'

export interface OpcionesProveedorApi {
  apiKey: string
  modelo: string
  esfuerzo: Esfuerzo
  /** Solo para pruebas: apunta el SDK a un servidor local. */
  baseURL?: string
  maxRetries?: number
  timeoutMs?: number
  /**
   * Reintento en el servidor cuando un clasificador de seguridad rechaza la petición
   * (`fallbacks: "default"`, beta server-side-fallback-2026-07-01). Activo por defecto.
   */
  fallbacks?: boolean
  /** Bloque de memoria del usuario; se consulta al empezar cada conversación. */
  memoria?: () => string | undefined
  /** Reloj, para la fecha del prompt (las pruebas lo fijan). */
  ahora?: () => Date
  /** Herramientas para actuar (modo agente). Sin ellas, el chat funciona como siempre. */
  agente?: OpcionesAgente
}

type Mensaje = Anthropic.Beta.BetaMessageParam
type BloqueParam = Anthropic.Beta.BetaContentBlockParam

const MAX_TOKENS = 32_000

/** Lo que se deja en el historial cuando el usuario detiene una tarea, para que los turnos sigan alternando bien. */
export const MARCA_DETENIDO = '[La tarea se detuvo por orden del usuario.]'
const OMITIDO = '[Resultado anterior omitido para ahorrar espacio.]'
/** Cuántas rondas de resultados de herramientas se conservan enteras; las anteriores largas se recortan. */
const RONDAS_CONSERVADAS = 3
const UMBRAL_RECORTE = 1500

function aResultado(r: ResultadoLlamada): BloqueParam {
  return { type: 'tool_result', tool_use_id: r.id, content: r.contenido, ...(r.esError ? { is_error: true } : {}) }
}

/**
 * Deja el historial válido tras detener una tarea: si el último mensaje del asistente pidió herramientas, se
 * contestan todas (con lo que ya se obtuvo o como «cancelado») y se cierra con una marca del asistente.
 */
export function repararHistorialCancelado(mensajes: Mensaje[], pendientes: ResultadoLlamada[]): void {
  const ultimo = mensajes[mensajes.length - 1]
  if (ultimo?.role === 'assistant' && Array.isArray(ultimo.content)) {
    const usos = ultimo.content.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === 'tool_use')
    if (usos.length > 0) {
      const porId = new Map(pendientes.map((p) => [p.id, p]))
      mensajes.push({
        role: 'user',
        content: usos.map((u) => aResultado(porId.get(u.id) ?? { id: u.id, contenido: 'Cancelado por el usuario.', esError: true }))
      })
    } else {
      // Un turno de asistente a medias (p. ej. una pausa de búsqueda) no se puede dejar suelto.
      mensajes.pop()
    }
  }
  mensajes.push({ role: 'assistant', content: MARCA_DETENIDO })
}

/** Recorta los resultados largos de rondas antiguas: el modelo ya los usó y no hace falta reenviarlos enteros. */
export function compactarResultadosAntiguos(mensajes: Mensaje[]): void {
  const rondas = mensajes
    .map((m, i) => (m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result') ? i : -1))
    .filter((i) => i >= 0)
  for (const i of rondas.slice(0, Math.max(0, rondas.length - RONDAS_CONSERVADAS))) {
    const contenido = mensajes[i].content as BloqueParam[]
    mensajes[i] = {
      role: 'user',
      content: contenido.map((b) =>
        b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > UMBRAL_RECORTE ? { ...b, content: OMITIDO } : b
      )
    }
  }
}

/**
 * Habla con Claude con el SDK oficial y una API key. La clave solo existe en el proceso principal.
 * La API no guarda estado: el historial de la conversación se conserva aquí y se reenvía entero.
 */
export class ProveedorApi implements ProveedorChat {
  readonly nombre = 'api' as const
  readonly modelo: string
  /** El esfuerzo va en cada petición, así que un cambio del marcador de potencia se nota en el siguiente mensaje. */
  readonly aplicaEsfuerzo = 'ahora' as const

  private esfuerzo: Esfuerzo
  private readonly cliente: Anthropic | null
  private historial: Anthropic.Beta.BetaMessageParam[] = []
  /** Prompt de la conversación en curso: se calcula en su primer turno y no cambia (así la caché del prompt se mantiene). */
  private prompt: string | null = null
  private controlador: AbortController | null = null
  private turnoEnCurso = false

  constructor(private readonly opciones: OpcionesProveedorApi) {
    this.modelo = opciones.modelo
    this.esfuerzo = opciones.esfuerzo
    this.cliente = opciones.apiKey
      ? new Anthropic({
          apiKey: opciones.apiKey,
          baseURL: opciones.baseURL,
          maxRetries: opciones.maxRetries ?? 2,
          timeout: opciones.timeoutMs ?? 120_000
        })
      : null
  }

  async enviar(entrada: TurnoEntrada, manejadores: ManejadoresTurno): Promise<ResultadoTurno> {
    if (!this.cliente) {
      throw new ErrorChat(
        crearError('clave_invalida', { mensaje: 'Falta la API key. Define ANTHROPIC_API_KEY en el archivo .env.' })
      )
    }
    if (this.turnoEnCurso) {
      throw new ErrorChat(
        crearError('solicitud_invalida', { mensaje: 'Todavía estoy respondiendo al mensaje anterior.' })
      )
    }

    this.turnoEnCurso = true
    const agente = agenteActivo(this.opciones.agente) ? this.opciones.agente : undefined
    // Hasta que haya un primer intercambio completo se recalcula (un primer intento fallido no fija la memoria).
    if (this.prompt === null || this.historial.length === 0) {
      this.prompt = construirPromptSistema({
        ahora: this.opciones.ahora?.(),
        memoria: this.opciones.memoria?.(),
        pasosAgente: agente?.maxPasos,
        busquedaWeb: agente ? hayBusquedaWeb(agente) : undefined
      })
    }
    const controlador = new AbortController()
    this.controlador = controlador
    const mensajeUsuario: Anthropic.Beta.BetaMessageParam = {
      role: 'user',
      content: construirBloques(entrada)
    }
    let texto = ''

    try {
      if (agente) return await this.turnoAgente(agente, mensajeUsuario, manejadores, controlador)

      const flujo = this.cliente.beta.messages.stream(
        {
          ...this.peticionBase(),
          messages: [...this.historial, mensajeUsuario]
        },
        { signal: controlador.signal }
      )
      flujo.on('text', (delta) => {
        texto += delta
        manejadores.alTexto(delta)
      })

      const final = await flujo.finalMessage()

      if (final.stop_reason === 'refusal') {
        const categoria = final.stop_details?.category
        throw new ErrorChat(
          crearError('rechazo', { detalle: categoria ? `categoría=${categoria}` : undefined })
        )
      }

      // Se guarda solo el texto: sin herramientas no hace falta reenviar los bloques de razonamiento.
      this.historial.push(mensajeUsuario, { role: 'assistant', content: texto })
      const motivo: MotivoFin = final.stop_reason === 'max_tokens' ? 'limite_tokens' : 'completo'
      return { motivo }
    } catch (e) {
      if (controlador.signal.aborted || e instanceof Anthropic.APIUserAbortError) {
        // Lo que ya se mostró forma parte de la conversación.
        if (!agente && texto) this.historial.push(mensajeUsuario, { role: 'assistant', content: texto })
        return { motivo: 'cancelado' }
      }
      if (e instanceof ErrorChat) throw e
      if (agente?.busquedaNativa && esBusquedaNoDisponible(e)) {
        throw new ErrorChat(
          crearError('solicitud_invalida', {
            mensaje:
              'La búsqueda web no está activada en tu cuenta de Anthropic (un administrador de la organización puede activarla en la Console). Pon ORBE_BUSQUEDA_MAX=0 en el archivo .env para seguir sin ella.',
            detalle: e instanceof Error ? e.message : undefined
          })
        )
      }
      throw new ErrorChat(errorDesdeApi(e))
    } finally {
      this.turnoEnCurso = false
      this.controlador = null
    }
  }

  /** Lo común a toda petición: modelo, prompt, esfuerzo y la red de seguridad del servidor. */
  private peticionBase() {
    return {
      model: this.opciones.modelo,
      max_tokens: MAX_TOKENS,
      system: this.prompt as string,
      output_config: { effort: this.esfuerzo },
      ...(this.opciones.fallbacks === false ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const })
    }
  }

  /**
   * Un turno con herramientas: el modelo pide una, la aplicación la ejecuta y le devuelve el resultado, hasta que
   * responde sin pedir más. El historial guarda los bloques tal como llegaron (con las herramientas y los
   * resultados), que es lo que la API exige para continuar.
   */
  private async turnoAgente(
    agente: OpcionesAgente,
    mensajeUsuario: Mensaje,
    m: ManejadoresTurno,
    controlador: AbortController
  ): Promise<ResultadoTurno> {
    const cliente = this.cliente as Anthropic
    const mensajes: Mensaje[] = [...this.historial, mensajeUsuario]
    const ejecutor = crearEjecutor(agente, controlador.signal, m)
    // Las nuestras (que ejecutamos aquí) y, si toca, la búsqueda web de Anthropic (que ejecutan sus servidores).
    const herramientas: Anthropic.Beta.BetaToolUnion[] = [
      ...agente.registro.paraAnthropic(),
      ...(agente.busquedaNativa ? [definicionBusquedaNativa(agente.busquedaNativa.maxUsos)] : [])
    ]
    const busquedas = new SeguimientoBusquedas(m)

    const resultado = await ejecutarBucle({
      maxPasos: agente.maxPasos,
      senal: controlador.signal,
      ejecutar: (llamada) => ejecutor.ejecutar(llamada),
      paso: async (resultados, modo): Promise<RespuestaPaso> => {
        if (resultados) mensajes.push({ role: 'user', content: resultados.map(aResultado) })
        compactarResultadosAntiguos(mensajes)
        const flujo = cliente.beta.messages.stream(
          {
            ...this.peticionBase(),
            messages: mensajes,
            tools: herramientas,
            tool_choice: modo.sinHerramientas ? { type: 'none' } : { type: 'auto', disable_parallel_tool_use: true }
          },
          { signal: controlador.signal }
        )
        flujo.on('text', (delta) => m.alTexto(delta))
        flujo.on('contentBlock', (bloque) => busquedas.alBloque(bloque))
        const final = await flujo.finalMessage()

        if (final.stop_reason === 'refusal') {
          const categoria = final.stop_details?.category
          throw new ErrorChat(crearError('rechazo', { detalle: categoria ? `categoría=${categoria}` : undefined }))
        }

        const fuentes = fuentesDeContenido(final.content)
        if (fuentes.length > 0) m.alFuentes?.(fuentes)

        let contenido = final.content as unknown as BloqueParam[]
        if (final.stop_reason === 'max_tokens') {
          // Una petición de herramienta (o de búsqueda) cortada a medias no se puede reenviar: se descarta.
          contenido = quitarBloquesIncompletos(contenido)
          if (contenido.length === 0) contenido = [{ type: 'text', text: '[Respuesta cortada por su longitud máxima.]' }]
        }
        mensajes.push({ role: 'assistant', content: contenido })

        if (final.stop_reason === 'pause_turn') return { fin: 'pausa', llamadas: [] }
        if (final.stop_reason === 'max_tokens') return { fin: 'limite_tokens', llamadas: [] }
        if (final.stop_reason === 'tool_use') {
          const llamadas: LlamadaHerramienta[] = final.content
            .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
            .map((b) => ({ id: b.id, nombre: b.name, entrada: b.input }))
          return { fin: 'herramientas', llamadas }
        }
        return { fin: 'completo', llamadas: [] }
      }
    })

    if (resultado.motivo === 'cancelado') repararHistorialCancelado(mensajes, resultado.pendientes)
    this.historial = mensajes
    return { motivo: resultado.motivo }
  }

  establecerEsfuerzo(nivel: Esfuerzo): void {
    this.esfuerzo = nivel
  }

  cancelar(): void {
    this.controlador?.abort()
  }

  reiniciar(): void {
    this.cancelar()
    this.historial = []
    this.prompt = null
  }

  cerrar(): void {
    this.cancelar()
  }
}
