/**
 * Origen de lo que el usuario le dice a Orbe. Hoy solo existe el teclado; la voz será otra
 * implementación de esta misma interfaz, sin tocar el chat.
 */
export interface FuenteEntrada {
  readonly origen: 'teclado' | 'voz'
  /** Se llama cuando el usuario termina un mensaje. */
  alEnviar(cb: (texto: string) => void): void
  enfocar(): void
  /** Hay algo escrito (o dictado) pendiente de enviar. */
  hayTexto(): boolean
  bloquear(bloqueado: boolean): void
}

const ALTURA_MAX = 120

/** Campo de texto del compositor: Enter envía, Mayús+Enter hace salto de línea. */
export class EntradaTeclado implements FuenteEntrada {
  readonly origen = 'teclado' as const
  private callback: ((texto: string) => void) | null = null

  constructor(
    private readonly campo: HTMLTextAreaElement,
    private readonly alCambiar: () => void
  ) {
    campo.addEventListener('input', () => {
      this.ajustarAltura()
      this.alCambiar()
    })
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        this.enviar()
      }
    })
  }

  alEnviar(cb: (texto: string) => void): void {
    this.callback = cb
  }

  /** Envía lo escrito (también lo usa el botón de enviar). */
  enviar(): void {
    const texto = this.campo.value.trim()
    if (!texto || !this.callback) return
    this.callback(texto)
  }

  /** Vacía el campo tras un envío aceptado. */
  limpiar(): void {
    this.campo.value = ''
    this.ajustarAltura()
    this.alCambiar()
  }

  /** Devuelve el texto al campo (p. ej. si el envío no se pudo iniciar). */
  restaurar(texto: string): void {
    this.campo.value = texto
    this.ajustarAltura()
    this.alCambiar()
  }

  enfocar(): void {
    this.campo.focus()
  }

  hayTexto(): boolean {
    return this.campo.value.trim().length > 0
  }

  /** Añade texto al final de lo escrito (por ejemplo, lo dictado), separado por un espacio. */
  insertar(texto: string): void {
    const actual = this.campo.value
    this.campo.value = actual && !/\s$/.test(actual) ? `${actual} ${texto}` : actual + texto
    this.ajustarAltura()
    this.alCambiar()
    this.campo.setSelectionRange(this.campo.value.length, this.campo.value.length)
  }

  /** Lo que hay escrito ahora mismo (sin enviar). */
  texto(): string {
    return this.campo.value
  }

  bloquear(bloqueado: boolean): void {
    this.campo.readOnly = bloqueado
  }

  private ajustarAltura(): void {
    this.campo.style.height = 'auto'
    this.campo.style.height = `${Math.min(this.campo.scrollHeight, ALTURA_MAX)}px`
  }
}
