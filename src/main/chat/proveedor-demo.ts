import { ErrorChat, crearError } from './errores'
import type { TurnoEntrada } from './contenido'
import type { ManejadoresTurno, ProveedorChat, ResultadoTurno } from './proveedor'

const RESPUESTA_DEMO = `Claro, esto es una **respuesta de demostración** para ver cómo se pinta el chat.

- Las listas se ven así
- Con \`código en línea\` y *énfasis*
- Y un [enlace de ejemplo](https://example.com)

\`\`\`ts
function saludar(nombre: string): string {
  return \`Hola, \${nombre}\`
}
\`\`\`

> Las citas también tienen su estilo.

¿Quieres que profundice en algo?`

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Frase con la que la demo confirma qué le llegó (pantalla, nota de la app, conversación anterior), para poder comprobarlo en las pruebas visuales. */
function acuseContexto(turno: TurnoEntrada): string {
  const partes: string[] = []
  const contexto = turno.contexto
  if (contexto) {
    const pantalla: string[] = []
    if (contexto.ventana) pantalla.push('ventana')
    if (contexto.seleccion) pantalla.push('selección')
    if (contexto.contenido) pantalla.push('contenido')
    if (contexto.imagen) pantalla.push('captura')
    if (pantalla.length > 0) partes.push(`contexto de pantalla: ${pantalla.join(', ')}`)
  }
  if (turno.notaApp) partes.push('nota de la app')
  if (turno.historialPrevio) partes.push('conversación anterior')
  return partes.length > 0 ? `*(Recibí ${partes.join('; ')}.)*\n\n` : ''
}

/** Proveedor de mentira para las pruebas visuales (--smoke): emite un texto fijo con ritmo de streaming. */
export class ProveedorDemo implements ProveedorChat {
  readonly nombre = 'cli' as const
  readonly modelo = 'demo'
  private cancelado = false

  constructor(private readonly ritmo = { pensarMs: 700, trozoMs: 30, trozo: 6 }) {}

  async enviar(turno: TurnoEntrada, m: ManejadoresTurno): Promise<ResultadoTurno> {
    this.cancelado = false
    await esperar(this.ritmo.pensarMs)
    if (turno.texto.startsWith('/error')) throw new ErrorChat(crearError('sin_conexion'))
    const respuesta = acuseContexto(turno) + RESPUESTA_DEMO
    for (let i = 0; i < respuesta.length && !this.cancelado; i += this.ritmo.trozo) {
      m.alTexto(respuesta.slice(i, i + this.ritmo.trozo))
      await esperar(this.ritmo.trozoMs)
    }
    return { motivo: this.cancelado ? 'cancelado' : 'completo' }
  }

  cancelar(): void {
    this.cancelado = true
  }

  reiniciar(): void {
    this.cancelado = true
  }

  cerrar(): void {
    this.cancelado = true
  }
}
