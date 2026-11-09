import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { frases, perfilDe, type PerfilIdentidad } from '../../shared/identidad'
import type { EjecucionTarea, EstadoTareas, TareaNueva, TareaVista } from '../../shared/tipos'
import type { PeticionConfirmacion } from '../agente/tipos'
import type { ProveedorChat } from '../chat/proveedor'
import type { ContadorUso } from '../chat/servicio'
import { aErrorOrbe } from '../chat/errores'
import { normalizarEvento, type BusActividad } from '../conectores/actividad'
import { siguienteEjecucion, validarTarea } from './programa'

export const MAX_TAREAS = 50
const HISTORIAL_MAX = 20
const RESULTADO_MAX = 6000
/** Si Orbe estuvo cerrado y una tarea se pasó de hora hace más de esto, no se recupera: se espera a la siguiente. */
export const RECUPERAR_MAX_MS = 12 * 3_600_000
/** Una tarea que tarda más se detiene. */
export const DURACION_MAX_MS = 15 * 60_000
/** Una petición de permiso sin respuesta en este tiempo cuenta como «no». */
export const PERMISO_MAX_MS = 30 * 60_000
const TICK_MS = 30_000
/** Lo que el agente responde cuando no hay nada que contar (con «solo si hay algo»). */
export const MARCA_NADA = 'NADA_NUEVO'

export interface DependenciasTareas {
  /** Dónde se guardan las tareas (null = solo en memoria, como en la prueba de humo). */
  archivo: string | null
  /** Crea un proveedor nuevo para cada ejecución (conversación limpia); null si no hay modelo con el que trabajar. */
  crearProveedor: (() => ProveedorChat) | null
  motivoNoDisponible?: string
  bus?: BusActividad
  contador?: ContadorUso
  /** Avisa al usuario fuera del panel (una notificación del sistema). */
  notificar?: (titulo: string, cuerpo: string) => void
  /** Algo cambió: la interfaz debe volver a pedir el estado. */
  alCambio?: () => void
  ahora?: () => number
  /** Quién avisa: los textos de las notificaciones salen con la voz de la identidad (por defecto, Orbe). */
  identidad?: PerfilIdentidad
}

interface EnCurso {
  tareaId: string
  ejecucion: EjecucionTarea
  proveedor: ProveedorChat
  cancelada: boolean
  permisos: Map<string, (permitir: boolean) => void>
  reloj: ReturnType<typeof setTimeout> | null
}

/** El texto que recibe el modelo en cada ejecución: la instrucción del usuario y cómo debe terminar. */
export function promptTarea(t: Pick<TareaVista, 'titulo' | 'instruccion' | 'soloSiHayAlgo'>, cuando: number): string {
  const fecha = new Date(cuando).toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' })
  return [
    `Tarea programada «${t.titulo}» (${fecha}). La haces tú solo, en segundo plano: el usuario no está mirando el chat.`,
    '',
    t.instruccion,
    '',
    'Cuando acabes, escribe un resumen corto y claro del resultado: lo que el usuario necesita saber o decidir. Sin saludos.',
    ...(t.soloSiHayAlgo ? [`Si no hay nada nuevo o importante que contar, responde únicamente «${MARCA_NADA}».`] : [])
  ].join('\n')
}

/**
 * Tareas de fondo al estilo de los agentes «siempre encendidos»: instrucciones que Orbe hace solo, ahora, a una hora,
 * cada día, algunos días de la semana o cada cierto tiempo. Cada ejecución es una conversación limpia con el modelo
 * configurado (con la memoria del usuario y las herramientas del agente). Lo que necesite permiso espera a que el
 * usuario responda; el personaje y una notificación avisan de lo que empieza, termina o te necesita.
 * Se hace una tarea cada vez; las que coinciden esperan en cola.
 */
export class ServicioTareas {
  private tareas: TareaVista[] = []
  private cola: string[] = []
  private enCurso: EnCurso | null = null
  private intervalo: ReturnType<typeof setInterval> | null = null
  private pendienteGuardar: ReturnType<typeof setTimeout> | null = null
  private readonly ahora: () => number
  private readonly frases: ReturnType<typeof frases>
  private readonly nombre: string

  constructor(private readonly d: DependenciasTareas) {
    this.ahora = d.ahora ?? Date.now
    const perfil = d.identidad ?? perfilDe({ id: 'orbe', nombre: '', trato: '' })
    this.frases = frases(perfil)
    this.nombre = perfil.nombre
    this.tareas = this.cargar()
  }

  // ------------------------------------------------------------------ ciclo de vida

  iniciar(): void {
    const t = this.ahora()
    // Lo que se pasó de hora con Orbe cerrado: si fue hace poco se hace ya; si no, se espera a la siguiente vez.
    for (const tarea of this.tareas) {
      if (tarea.ultima?.estado === 'en-curso' || tarea.ultima?.estado === 'esperando') {
        tarea.ultima = { ...tarea.ultima, estado: 'cancelada', fin: t, resultado: tarea.ultima.resultado || 'Orbe se cerró antes de terminarla.' }
        delete tarea.ultima.permiso
        tarea.historial[0] = tarea.ultima
      }
      if (tarea.activa && tarea.proxima !== null && tarea.proxima <= t && t - tarea.proxima > RECUPERAR_MAX_MS) {
        tarea.proxima = siguienteEjecucion(tarea.programa, t, tarea.creada)
      }
    }
    this.revisar()
    this.intervalo = setInterval(() => this.revisar(), TICK_MS)
    this.intervalo.unref?.()
  }

  detener(): void {
    if (this.intervalo) clearInterval(this.intervalo)
    this.intervalo = null
    if (this.enCurso) this.cancelar(this.enCurso.tareaId)
    this.guardarAhora()
  }

  /** Mira qué tareas tocan ya y las pone en cola. */
  revisar(): void {
    const t = this.ahora()
    for (const tarea of this.tareas) {
      if (!tarea.activa || tarea.proxima === null || tarea.proxima > t) continue
      tarea.proxima = siguienteEjecucion(tarea.programa, t, tarea.creada)
      this.encolar(tarea.id)
    }
    this.guardarPronto()
  }

  // ------------------------------------------------------------------ consultas y cambios

  estado(): EstadoTareas {
    return {
      tareas: this.tareas.map((t) => ({ ...t, historial: t.historial.map((h) => ({ ...h })), ultima: t.ultima ? { ...t.ultima } : null })),
      disponible: this.d.crearProveedor !== null,
      ...(this.d.crearProveedor === null ? { motivo: this.d.motivoNoDisponible ?? 'No hay ningún modelo configurado.' } : {})
    }
  }

  guardar(entrada: TareaNueva): EstadoTareas | { error: string } {
    const v = validarTarea(entrada, this.ahora())
    if (!v.ok) return { error: v.error }
    const t = this.ahora()
    const existente = v.tarea.id ? this.tareas.find((x) => x.id === v.tarea.id) : undefined
    if (!existente && this.tareas.length >= MAX_TAREAS) return { error: `Como mucho ${MAX_TAREAS} tareas.` }
    const tarea: TareaVista = existente ?? {
      id: randomUUID(),
      titulo: '',
      instruccion: '',
      programa: { tipo: 'ahora' },
      activa: true,
      soloSiHayAlgo: false,
      creada: t,
      proxima: null,
      ultima: null,
      historial: []
    }
    const cambiaPrograma = JSON.stringify(tarea.programa) !== JSON.stringify(v.tarea.programa)
    tarea.titulo = v.tarea.titulo
    tarea.instruccion = v.tarea.instruccion
    tarea.programa = v.tarea.programa
    tarea.activa = v.tarea.activa
    tarea.soloSiHayAlgo = v.tarea.soloSiHayAlgo
    if (!existente || cambiaPrograma) tarea.creada = t
    tarea.proxima = tarea.activa ? siguienteEjecucion(tarea.programa, t, tarea.creada) : null
    if (!existente) this.tareas.unshift(tarea)
    if (tarea.programa.tipo === 'ahora' && tarea.activa && (!existente || cambiaPrograma)) this.encolar(tarea.id)
    this.cambio()
    return this.estado()
  }

  borrar(id: string): EstadoTareas {
    if (this.enCurso?.tareaId === id) this.cancelar(id)
    this.tareas = this.tareas.filter((t) => t.id !== id)
    this.cola = this.cola.filter((c) => c !== id)
    this.cambio()
    return this.estado()
  }

  /** «Hacer ahora»: la pone la primera de la cola sin tocar su programa. */
  ejecutarYa(id: string): EstadoTareas {
    if (this.tareas.some((t) => t.id === id) && this.enCurso?.tareaId !== id && !this.cola.includes(id)) {
      this.cola.unshift(id)
      this.siguiente()
    }
    return this.estado()
  }

  cancelar(id: string): EstadoTareas {
    this.cola = this.cola.filter((c) => c !== id)
    const e = this.enCurso
    if (e && e.tareaId === id) {
      e.cancelada = true
      for (const resolver of e.permisos.values()) resolver(false)
      e.permisos.clear()
      e.proveedor.cancelar()
    }
    this.cambio()
    return this.estado()
  }

  responder(id: string, confirmacionId: string, permitir: boolean): EstadoTareas {
    const e = this.enCurso
    const resolver = e && e.tareaId === id ? e.permisos.get(confirmacionId) : undefined
    if (e && resolver) {
      e.permisos.delete(confirmacionId)
      delete e.ejecucion.permiso
      e.ejecucion.estado = 'en-curso'
      resolver(permitir)
      this.cambio()
    }
    return this.estado()
  }

  // ------------------------------------------------------------------ ejecución

  private encolar(id: string): void {
    if (this.enCurso?.tareaId === id || this.cola.includes(id)) return
    this.cola.push(id)
    queueMicrotask(() => this.siguiente())
  }

  private siguiente(): void {
    if (this.enCurso) return
    const id = this.cola.shift()
    if (!id) return
    const tarea = this.tareas.find((t) => t.id === id)
    if (!tarea) return this.siguiente()
    void this.ejecutar(tarea).finally(() => this.siguiente())
  }

  private async ejecutar(tarea: TareaVista): Promise<void> {
    const inicio = this.ahora()
    const ejecucion: EjecucionTarea = { id: randomUUID(), inicio, fin: null, estado: 'en-curso', resultado: '' }
    tarea.ultima = ejecucion
    tarea.historial.unshift(ejecucion)
    tarea.historial.splice(HISTORIAL_MAX)

    if (!this.d.crearProveedor) {
      this.terminar(tarea, ejecucion, 'error', this.d.motivoNoDisponible ?? 'No hay ningún modelo configurado.')
      return
    }
    let proveedor: ProveedorChat
    try {
      proveedor = this.d.crearProveedor()
    } catch (e) {
      this.terminar(tarea, ejecucion, 'error', aErrorOrbe(e).mensaje)
      return
    }
    const actual: EnCurso = { tareaId: tarea.id, ejecucion, proveedor, cancelada: false, permisos: new Map(), reloj: null }
    this.enCurso = actual
    actual.reloj = setTimeout(() => {
      ejecucion.resultado = 'Tardaba demasiado (más de 15 minutos): la he detenido.'
      this.cancelar(tarea.id)
    }, DURACION_MAX_MS)
    actual.reloj.unref?.()
    this.publicar('inicio', `Empiezo: ${tarea.titulo}`, undefined, 'concentrado')
    this.cambio()

    let texto = ''
    /** Hubo una acción desde el último texto: el siguiente tramo va en párrafo nuevo (como en el chat). */
    let separar = false
    try {
      const r = await proveedor.enviar(
        { texto: promptTarea(tarea, inicio) },
        {
          alTexto: (delta) => {
            if (separar && texto) texto += '\n\n'
            separar = false
            texto += delta
          },
          alAccion: (accion) => {
            separar = true
            if (accion.estado === 'en_curso') {
              ejecucion.paso = accion.titulo
              this.cambio()
            }
          },
          alUso: (uso) => this.d.contador?.uso(uso),
          alLimite: (limite) => this.d.contador?.limite?.(limite),
          confirmar: (peticion) => this.pedirPermiso(tarea, actual, peticion)
        }
      )
      const limpio = texto.trim()
      if (actual.cancelada || r.motivo === 'cancelado') {
        this.terminar(tarea, ejecucion, 'cancelada', ejecucion.resultado || limpio || 'Detenida.')
      } else if (tarea.soloSiHayAlgo && (limpio === MARCA_NADA || limpio.replace(/[«».\s]/g, '') === MARCA_NADA)) {
        this.terminar(tarea, ejecucion, 'nada-nuevo', 'Nada nuevo.')
      } else {
        this.terminar(tarea, ejecucion, 'completada', limpio || 'Hecha (sin texto de respuesta).')
      }
    } catch (e) {
      const error = aErrorOrbe(e)
      this.terminar(tarea, ejecucion, 'error', `${error.titulo}. ${error.mensaje}`)
    } finally {
      if (actual.reloj) clearTimeout(actual.reloj)
      for (const resolver of actual.permisos.values()) resolver(false)
      try {
        proveedor.cerrar()
      } catch {
        // ya estaba cerrado
      }
      if (this.enCurso === actual) this.enCurso = null
      this.cambio()
    }
  }

  private pedirPermiso(tarea: TareaVista, actual: EnCurso, p: PeticionConfirmacion): Promise<boolean> {
    if (actual.cancelada) return Promise.resolve(false)
    const confirmacionId = randomUUID()
    actual.ejecucion.estado = 'esperando'
    actual.ejecucion.permiso = { confirmacionId, titulo: p.titulo, detalle: p.detalle, peligrosa: p.peligrosa === true }
    this.publicar('esperando', `«${tarea.titulo}» te necesita`, p.titulo, 'sorprendido')
    this.d.notificar?.(this.frases.tareaPermiso(tarea.titulo), `${p.titulo}. Abre ${this.nombre} → Tareas para permitirlo o no.`)
    this.cambio()
    return new Promise<boolean>((resolver) => {
      const reloj = setTimeout(() => {
        if (actual.permisos.delete(confirmacionId)) {
          delete actual.ejecucion.permiso
          actual.ejecucion.estado = 'en-curso'
          resolver(false)
          this.cambio()
        }
      }, PERMISO_MAX_MS)
      reloj.unref?.()
      actual.permisos.set(confirmacionId, (permitir) => {
        clearTimeout(reloj)
        resolver(permitir)
      })
    })
  }

  private terminar(tarea: TareaVista, e: EjecucionTarea, estado: EjecucionTarea['estado'], resultado: string): void {
    e.estado = estado
    e.fin = this.ahora()
    e.resultado = resultado.length > RESULTADO_MAX ? `${resultado.slice(0, RESULTADO_MAX - 1)}…` : resultado
    delete e.paso
    delete e.permiso
    // Una tarea de una sola vez que ya se hizo deja de estar activa (queda en «Completadas»).
    if (tarea.proxima === null && (tarea.programa.tipo === 'ahora' || tarea.programa.tipo === 'una-vez')) tarea.activa = false
    const resumen = e.resultado.replace(/\s+/g, ' ').slice(0, 180)
    if (estado === 'completada') {
      this.publicar('terminado', `Hecho: ${tarea.titulo}`, resumen, 'orgulloso')
      this.d.notificar?.(this.frases.tareaTerminada(tarea.titulo), resumen)
    } else if (estado === 'error') {
      this.publicar('error', `No pude con «${tarea.titulo}»`, resumen, 'preocupado')
      this.d.notificar?.(this.frases.tareaFallida(tarea.titulo), resumen)
    } else if (estado === 'nada-nuevo') {
      this.publicar('info', `${tarea.titulo}: nada nuevo`)
    }
    this.cambio()
  }

  private publicar(tipo: string, titulo: string, detalle?: string, expresion?: string): void {
    const evento = normalizarEvento({ origen: 'tareas', tipo, titulo, detalle, expresion }, 'tareas')
    if (evento) this.d.bus?.publicar(evento)
  }

  // ------------------------------------------------------------------ disco

  private cambio(): void {
    this.guardarPronto()
    this.d.alCambio?.()
  }

  private cargar(): TareaVista[] {
    if (!this.d.archivo || !existsSync(this.d.archivo)) return []
    try {
      const datos = JSON.parse(readFileSync(this.d.archivo, 'utf8')) as { version?: number; tareas?: unknown[] }
      if (datos.version !== 1 || !Array.isArray(datos.tareas)) return []
      const t = this.ahora()
      const r: TareaVista[] = []
      for (const bruta of datos.tareas.slice(0, MAX_TAREAS)) {
        const b = bruta as Partial<TareaVista>
        const v = validarTarea({ ...b, programa: b.programa?.tipo === 'una-vez' ? { ...b.programa, en: Math.max(b.programa.en, t + 1) } : b.programa }, t)
        if (!v.ok || typeof b.id !== 'string') continue
        r.push({
          ...v.tarea,
          programa: b.programa as TareaVista['programa'],
          id: b.id,
          creada: typeof b.creada === 'number' ? b.creada : t,
          proxima: typeof b.proxima === 'number' ? b.proxima : null,
          ultima: Array.isArray(b.historial) && b.historial[0] ? (b.historial[0] as EjecucionTarea) : null,
          historial: Array.isArray(b.historial) ? (b.historial.slice(0, HISTORIAL_MAX) as EjecucionTarea[]) : []
        })
      }
      return r
    } catch {
      return []
    }
  }

  private guardarPronto(): void {
    if (!this.d.archivo || this.pendienteGuardar) return
    this.pendienteGuardar = setTimeout(() => this.guardarAhora(), 500)
    this.pendienteGuardar.unref?.()
  }

  guardarAhora(): void {
    if (this.pendienteGuardar) clearTimeout(this.pendienteGuardar)
    this.pendienteGuardar = null
    if (!this.d.archivo) return
    try {
      mkdirSync(dirname(this.d.archivo), { recursive: true })
      const temporal = `${this.d.archivo}.tmp`
      writeFileSync(temporal, JSON.stringify({ version: 1, tareas: this.tareas }), 'utf8')
      renameSync(temporal, this.d.archivo)
    } catch {
      // sin disco: las tareas siguen en memoria hasta cerrar Orbe
    }
  }
}

