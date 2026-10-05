import type { AccionVista } from '../../shared/tipos'
import { ErrorChat, crearError } from './errores'
import type { TurnoEntrada } from './contenido'
import type { Esfuerzo, ManejadoresTurno, ProveedorChat, ResultadoTurno } from './proveedor'

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

/** Una acción del agente de mentira, para ver cómo se pinta (la demo no usa ninguna herramienta de verdad). */
function accionDemo(id: string, titulo: string, estado: AccionVista['estado'], resultado?: string): AccionVista {
  return { accionId: id, herramienta: 'demo', titulo, parametros: '{"demo":true}', estado, ...(resultado ? { resultado } : {}) }
}

/** Proveedor de mentira para las pruebas visuales (--smoke): emite un texto fijo con ritmo de streaming. */
export class ProveedorDemo implements ProveedorChat {
  readonly nombre = 'cli' as const
  readonly modelo = 'demo'
  readonly aplicaEsfuerzo = 'ahora' as const
  /** El último nivel del marcador de potencia que se pidió (las pruebas lo consultan). */
  esfuerzo: Esfuerzo = 'medium'
  private cancelado = false

  establecerEsfuerzo(nivel: Esfuerzo): void {
    this.esfuerzo = nivel
  }

  constructor(private readonly ritmo = { pensarMs: 700, trozoMs: 30, trozo: 6 }) {}

  /**
   * «/acciones»: texto, una búsqueda, una confirmación del usuario y más texto, como haría el agente.
   * «/colgada»: una acción que no termina hasta que el usuario pulsa Detener.
   */
  private async simularAgente(texto: string, m: ManejadoresTurno): Promise<ResultadoTurno> {
    m.alTexto('Voy a buscarlo.')
    await esperar(150)
    m.alAccion?.(accionDemo('demo-1', 'Buscando: tiempo en Lima', 'en_curso'))
    if (texto.startsWith('/colgada')) {
      while (!this.cancelado) await esperar(40)
      m.alAccion?.(accionDemo('demo-1', 'Buscando: tiempo en Lima', 'cancelada', 'Detenida.'))
      return { motivo: 'cancelado' }
    }
    await esperar(900)
    m.alAccion?.(accionDemo('demo-1', 'Buscando: tiempo en Lima', 'ok', '3 resultados'))
    const permitido = m.confirmar
      ? await m.confirmar({ titulo: 'Enviar el formulario de contacto', detalle: 'Pulsará «Enviar» en example.com. No se puede deshacer.' })
      : false
    m.alAccion?.(accionDemo('demo-2', 'Enviando el formulario', 'en_curso'))
    await esperar(500)
    m.alAccion?.(
      permitido ? accionDemo('demo-2', 'Enviando el formulario', 'ok', 'Enviado') : accionDemo('demo-2', 'Enviando el formulario', 'denegada', 'No la permitiste.')
    )
    m.alTexto(permitido ? 'Listo: formulario enviado.' : 'No envié el formulario, como pediste.')
    return { motivo: this.cancelado ? 'cancelado' : 'completo' }
  }

  /**
   * «/busca»: una búsqueda web con sus fuentes bajo la respuesta. Las fuentes llevan a propósito un título con HTML y
   * un enlace que no es web, para comprobar que la interfaz muestra el texto tal cual y descarta lo que no sea http(s).
   */
  private async simularBusqueda(m: ManejadoresTurno): Promise<ResultadoTurno> {
    m.alTexto('Voy a buscarlo en internet.')
    await esperar(150)
    m.alAccion?.(accionDemo('demo-b', 'Buscando: tiempo en Lima', 'en_curso'))
    await esperar(600)
    m.alAccion?.(accionDemo('demo-b', 'Buscando: tiempo en Lima', 'ok', '3 resultados'))
    m.alFuentes?.([
      { titulo: 'El tiempo en Lima hoy', url: 'https://www.ejemplo.org/tiempo/lima' },
      { titulo: '<img src=x onerror=alert(1)> Previsión semanal', url: 'https://clima.example.com/lima?dias=7' },
      { titulo: 'Enlace que no es web', url: 'javascript:alert(1)' },
      { titulo: 'El tiempo en Lima hoy (repetida)', url: 'https://www.ejemplo.org/tiempo/lima' }
    ])
    m.alTexto('En Lima hay unos 19 °C y el cielo está nublado.')
    return { motivo: this.cancelado ? 'cancelado' : 'completo' }
  }

  async enviar(turno: TurnoEntrada, m: ManejadoresTurno): Promise<ResultadoTurno> {
    this.cancelado = false
    await esperar(this.ritmo.pensarMs)
    if (turno.texto.startsWith('/error')) throw new ErrorChat(crearError('sin_conexion'))
    if (turno.texto.startsWith('/busca')) return this.simularBusqueda(m)
    if (turno.texto.startsWith('/acciones') || turno.texto.startsWith('/colgada')) return this.simularAgente(turno.texto, m)
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
