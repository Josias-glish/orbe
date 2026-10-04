import Anthropic from '@anthropic-ai/sdk'
import type { MotivoFin } from '../../shared/tipos'
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
}

const MAX_TOKENS = 32_000

/**
 * Habla con Claude con el SDK oficial y una API key. La clave solo existe en el proceso principal.
 * La API no guarda estado: el historial de la conversación se conserva aquí y se reenvía entero.
 */
export class ProveedorApi implements ProveedorChat {
  readonly nombre = 'api' as const
  readonly modelo: string

  private readonly cliente: Anthropic | null
  private historial: Anthropic.Beta.BetaMessageParam[] = []
  /** Prompt de la conversación en curso: se calcula en su primer turno y no cambia (así la caché del prompt se mantiene). */
  private prompt: string | null = null
  private controlador: AbortController | null = null
  private turnoEnCurso = false

  constructor(private readonly opciones: OpcionesProveedorApi) {
    this.modelo = opciones.modelo
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
    // Hasta que haya un primer intercambio completo se recalcula (un primer intento fallido no fija la memoria).
    if (this.prompt === null || this.historial.length === 0) {
      this.prompt = construirPromptSistema({ ahora: this.opciones.ahora?.(), memoria: this.opciones.memoria?.() })
    }
    const controlador = new AbortController()
    this.controlador = controlador
    const mensajeUsuario: Anthropic.Beta.BetaMessageParam = {
      role: 'user',
      content: construirBloques(entrada)
    }
    let texto = ''

    try {
      const flujo = this.cliente.beta.messages.stream(
        {
          model: this.opciones.modelo,
          max_tokens: MAX_TOKENS,
          system: this.prompt,
          messages: [...this.historial, mensajeUsuario],
          output_config: { effort: this.opciones.esfuerzo },
          ...(this.opciones.fallbacks === false
            ? {}
            : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const })
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
        if (texto) this.historial.push(mensajeUsuario, { role: 'assistant', content: texto })
        return { motivo: 'cancelado' }
      }
      if (e instanceof ErrorChat) throw e
      throw new ErrorChat(errorDesdeApi(e))
    } finally {
      this.turnoEnCurso = false
      this.controlador = null
    }
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
