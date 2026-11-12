import type {
  AvisoMemoria,
  CambiosRecuerdo,
  ConversacionArchivada,
  MensajeGuardado,
  PropuestaLimpieza,
  EstadoMemoria,
  InformeImportacion,
  InicioMemoria,
  ResultadoMemoria
} from '../../shared/tipos'
import { AlmacenMemoria, MAX_CUERPO, MAX_DESCRIPCION, MAX_RECUERDOS, type Recuerdo } from './almacen'
import { construirBloqueMemoria } from './bloque'
import { detectarOrdenRecordar } from './captura'
import { AlmacenConversacion, construirHistorialPrevio, tituloDe } from './conversacion'
import { caducado, proponerLimpieza } from './consolidar'
import { carpetasClaudePorDefecto, importarDeClaude } from './importador'
import { buscarSensible } from './secretos'

export interface OpcionesServicioMemoria {
  /** Carpeta de los recuerdos (un .md por recuerdo). */
  carpeta: string
  /** Archivo donde se guarda la conversación en curso. */
  archivoConversacion: string
  /** Presupuesto de caracteres de recuerdos que viajan en cada conversación. */
  max: number
  /** Carpetas de memoria de Claude de donde importar; null = las de Claude Code por defecto. */
  origenesClaude: string[] | null
  ahora?: () => Date
  /** Cuándo se usó por última vez cada recuerdo (base de datos local); sin esto nada caduca. */
  ultimoUso?: (id: string) => string | null
  /** Un intercambio terminó: marca como usados los recuerdos que tienen que ver con lo que se habló. */
  alTurno?: (usuario: string) => void
}

/** Resultado de interpretar un mensaje como orden de memoria: qué se le dice al usuario y qué se le cuenta al modelo. */
export interface CapturaMemoria {
  aviso: AvisoMemoria
  nota: string
}

/** La primera línea del texto, recortada por palabras para que quepa como resumen. */
function resumir(texto: string, max: number): string {
  const linea = texto.split('\n').find((l) => l.trim())?.trim() ?? ''
  if (linea.length <= max) return linea
  const corte = linea.lastIndexOf(' ', max)
  return `${linea.slice(0, corte > max * 0.6 ? corte : max).trimEnd()}…`
}

const plural = (n: number, uno: string, varios: string): string => (n === 1 ? uno : varios)

/**
 * Lo que Orbe sabe del usuario entre sesiones: sus recuerdos (propios o traídos de la memoria de Claude)
 * y la conversación que dejó a medias. Todo vive en claro en la carpeta de datos de la aplicación.
 */
export class ServicioMemoria {
  private readonly almacen: AlmacenMemoria
  private readonly conversacion: AlmacenConversacion
  private historialPendiente: string | null = null

  constructor(private readonly opciones: OpcionesServicioMemoria) {
    this.almacen = new AlmacenMemoria(opciones.carpeta)
    this.conversacion = new AlmacenConversacion(opciones.archivoConversacion)
  }

  private ahora(): Date {
    return this.opciones.ahora?.() ?? new Date()
  }

  /** La carpeta donde viven los recuerdos (para abrirla en el Explorador). */
  get carpeta(): string {
    return this.opciones.carpeta
  }

  /** Al arrancar: la primera vez trae la memoria de Claude (y lo avisa una vez); después prepara la conversación guardada. */
  iniciar(): void {
    if (!this.almacen.config().importacionInicialHecha) {
      const informe = this.importar()
      const config = this.almacen.config()
      config.importacionInicialHecha = true
      config.bienvenida =
        informe.nuevas > 0
          ? `He cargado ${informe.nuevas} ${plural(informe.nuevas, 'nota', 'notas')} de la memoria de Claude (quién eres, tus gustos y tus proyectos). ` +
            'Puedes revisarlas, desactivar las que no quieras o borrarlas desde el botón de memoria.'
          : null
      this.almacen.guardarConfig(config)
    }
    this.prepararHistorial()
  }

  activa(): boolean {
    return this.almacen.config().activa
  }

  fijarActiva(activa: boolean): void {
    const config = this.almacen.config()
    config.activa = activa
    this.almacen.guardarConfig(config)
    if (activa) this.prepararHistorial()
    else this.historialPendiente = null
  }

  // -------------------------------------------------------------------------------------------
  // Recuerdos
  // -------------------------------------------------------------------------------------------

  /** El bloque «Memoria del usuario» para el prompt de una conversación nueva; undefined si no hay o está apagada. */
  bloquePrompt(): string | undefined {
    if (!this.activa()) return undefined
    const texto = construirBloqueMemoria(this.almacen.listar().map((r) => paraPrompt(r, this.caduco(r))), this.opciones.max).texto
    return texto || undefined
  }

  estado(): EstadoMemoria {
    const recuerdos = this.almacen.listar()
    const bloque = construirBloqueMemoria(recuerdos.map((r) => paraPrompt(r, this.caduco(r))), this.opciones.max)
    return {
      activa: this.activa(),
      propuestas: this.propuestas(recuerdos),
      recuerdos: recuerdos.map((r) => ({
        id: r.id,
        tipo: r.tipo,
        titulo: r.descripcion,
        cuerpo: r.cuerpo,
        origen: r.origen,
        fuente: r.fuente ?? (r.origen === 'claude' ? 'Memoria de Claude Code' : undefined),
        usar: r.usar,
        completo: r.completo,
        ...(this.caduco(r) ? { caducado: true } : {}),
        caracteres: bloque.porRecuerdo[r.id] ?? 0,
        modificado: r.modificado
      })),
      presupuesto: { usados: bloque.usados, max: this.opciones.max, omitidos: bloque.omitidos },
      carpeta: this.opciones.carpeta,
      hayConversacion: this.conversacion.hay()
    }
  }

  /** Crea una nota del usuario. Con `forzar` se guarda aunque parezca contener un dato delicado. */
  guardarNota(texto: string, forzar = false, fuente = 'A mano, desde el gestor de memoria'): ResultadoMemoria {
    const creada = this.crearNota(texto, forzar, fuente)
    if (creada.ok) return { ok: true, id: creada.id, estado: this.estado() }
    return { ok: false, error: creada.error, ...(creada.sensible ? { sensible: true } : {}) }
  }

  /**
   * Crea una nota. Si no puede, devuelve el mensaje completo (`error`, para el gestor) y el `motivo` corto
   * (para completar «No se guardó: …» en el chat y para contárselo al modelo).
   */
  private crearNota(
    texto: string,
    forzar: boolean,
    fuente: string
  ): { ok: true; id: string; duplicado: boolean } | { ok: false; error: string; motivo: string; sensible?: boolean } {
    const cuerpo = texto.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    if (!cuerpo) return { ok: false, error: 'Escribe algo que Orbe deba recordar.', motivo: 'no hay nada que guardar' }
    if (cuerpo.length > MAX_CUERPO) {
      return {
        ok: false,
        error: `Es demasiado largo (máximo ${MAX_CUERPO} caracteres).`,
        motivo: `es demasiado largo (máximo ${MAX_CUERPO} caracteres)`
      }
    }

    const existentes = this.almacen.listar()
    const igual = existentes.find((r) => r.cuerpo.trim().toLowerCase() === cuerpo.toLowerCase())
    if (igual) return { ok: true, id: igual.id, duplicado: true }
    if (existentes.length >= MAX_RECUERDOS) {
      return {
        ok: false,
        error: `Ya hay ${MAX_RECUERDOS} recuerdos. Borra alguno antes de añadir más.`,
        motivo: `ya hay ${MAX_RECUERDOS} recuerdos guardados`
      }
    }
    if (!forzar) {
      const sensible = buscarSensible(cuerpo)
      if (sensible) {
        return {
          ok: false,
          error: `Parece contener ${sensible}. No se guardó, por si es un dato que no debe quedar escrito.`,
          motivo: `parece contener ${sensible}`,
          sensible: true
        }
      }
    }

    const id = this.almacen.idLibre(`nota-${resumir(cuerpo, 40)}`)
    this.almacen.guardar({
      id,
      tipo: 'nota',
      descripcion: resumir(cuerpo, 140),
      cuerpo,
      origen: 'usuario',
      fuente,
      usar: true,
      completo: true,
      modificado: this.ahora().toISOString()
    })
    return { ok: true, id, duplicado: false }
  }

  actualizar(id: string, cambios: CambiosRecuerdo, forzar = false): ResultadoMemoria {
    const actual = this.almacen.obtener(id)
    if (!actual) return { ok: false, error: 'Ese recuerdo ya no existe.' }

    const siguiente: Recuerdo = { ...actual }
    if (cambios.titulo !== undefined) {
      const titulo = cambios.titulo.replace(/\s+/g, ' ').trim()
      if (!titulo) return { ok: false, error: 'El resumen no puede estar vacío.' }
      if (titulo.length > MAX_DESCRIPCION) return { ok: false, error: `El resumen es demasiado largo (máximo ${MAX_DESCRIPCION} caracteres).` }
      siguiente.descripcion = titulo
    }
    if (cambios.cuerpo !== undefined) {
      const cuerpo = cambios.cuerpo.replace(/\r\n?/g, '\n').trim()
      if (cuerpo.length > MAX_CUERPO) return { ok: false, error: `Es demasiado largo (máximo ${MAX_CUERPO} caracteres).` }
      siguiente.cuerpo = cuerpo
    }
    if (cambios.usar !== undefined) siguiente.usar = cambios.usar
    if (cambios.completo !== undefined) siguiente.completo = cambios.completo

    const cambioTexto = siguiente.descripcion !== actual.descripcion || siguiente.cuerpo !== actual.cuerpo
    if (cambioTexto) {
      if (!forzar) {
        const sensible = buscarSensible(`${siguiente.descripcion}\n${siguiente.cuerpo}`)
        if (sensible) {
          return { ok: false, error: `Parece contener ${sensible}. No se guardó, por si es un dato que no debe quedar escrito.`, sensible: true }
        }
      }
      siguiente.modificado = this.ahora().toISOString()
    }
    this.almacen.guardar(siguiente)
    return { ok: true, id, estado: this.estado() }
  }

  /** Borra un recuerdo. Si venía de Claude, se anota para que una nueva importación no lo resucite. */
  private caduco(r: Recuerdo): boolean {
    return !!this.opciones.ultimoUso && caducado(r, this.opciones.ultimoUso(r.id), this.ahora())
  }

  /** La consolidación: duplicados y recuerdos sin usar que se proponen archivar. */
  propuestas(recuerdos = this.almacen.listar()): PropuestaLimpieza[] {
    const uso = this.opciones.ultimoUso ?? (() => new Date().toISOString())
    return proponerLimpieza(recuerdos, uso, this.ahora(), new Set(this.almacen.config().descartadas ?? []))
  }

  /** Aceptar archiva el recuerdo (a `_archivo/`, sin borrarlo); descartar hace que no se vuelva a proponer. */
  resolverPropuesta(id: string, aceptar: boolean): ResultadoMemoria {
    const p = this.propuestas().find((x) => x.id === id)
    if (!p) return { ok: false, error: 'Esa propuesta ya no está.' }
    const config = this.almacen.config()
    if (aceptar) {
      // Si venía de Claude, no se vuelve a importar.
      const clave = Object.keys(config.importados).find((k) => config.importados[k].id === p.archivar)
      if (clave) {
        delete config.importados[clave]
        if (!config.ignorados.includes(clave)) config.ignorados.push(clave)
        this.almacen.guardarConfig(config)
      }
      this.almacen.archivar(p.archivar)
    } else {
      config.descartadas = [...(config.descartadas ?? []), id].slice(-500)
      this.almacen.guardarConfig(config)
    }
    return { ok: true, estado: this.estado() }
  }

  borrar(id: string): ResultadoMemoria {
    const r = this.almacen.obtener(id)
    if (!r) return { ok: false, error: 'Ese recuerdo ya no existe.' }
    const config = this.almacen.config()
    const clave = Object.keys(config.importados).find((k) => config.importados[k].id === id)
    if (clave) {
      delete config.importados[clave]
      if (!config.ignorados.includes(clave)) config.ignorados.push(clave)
      this.almacen.guardarConfig(config)
    }
    this.almacen.borrar(id)
    return { ok: true, estado: this.estado() }
  }

  /** Borra todos los recuerdos (la conversación guardada se olvida con «Nueva conversación»). */
  vaciar(): ResultadoMemoria {
    this.almacen.vaciar()
    return { ok: true, estado: this.estado() }
  }

  importar(): InformeImportacion {
    return importarDeClaude(this.opciones.origenesClaude ?? carpetasClaudePorDefecto(), this.almacen, this.ahora())
  }

  // -------------------------------------------------------------------------------------------
  // Órdenes de memoria en el chat («Recuerda que…»)
  // -------------------------------------------------------------------------------------------

  /**
   * Si el mensaje es una orden de recordar un dato, la ejecuta y devuelve qué ha pasado, tanto para
   * mostrárselo al usuario como para que el modelo no afirme algo falso (él no puede guardar nada).
   */
  capturar(texto: string): CapturaMemoria | null {
    const orden = detectarOrdenRecordar(texto)
    if (!orden) return null
    const noGuardado = (motivo: string, pista: string): CapturaMemoria => ({
      aviso: { tipo: 'no_guardado', motivo },
      nota: `Orbe NO ha guardado la nota «${orden.hecho}» en la memoria del usuario. Motivo: ${motivo}. ${pista}`
    })

    if (!this.activa()) {
      return noGuardado('la memoria está desactivada', 'Díselo y explícale que puede activarla desde el botón de memoria del panel.')
    }
    const r = this.crearNota(orden.hecho, false, this.fuenteChat())
    if (!r.ok) {
      const pista = r.sensible
        ? 'Díselo con amabilidad y sugiérele no compartir datos así; si de verdad quiere guardarlo, puede hacerlo a mano desde el botón de memoria.'
        : 'Díselo con amabilidad.'
      return noGuardado(r.motivo, pista)
    }
    if (r.duplicado) {
      return {
        aviso: { tipo: 'guardado', id: r.id, texto: orden.hecho },
        nota: `El usuario ha pedido recordar «${orden.hecho}», pero Orbe ya lo tenía en su memoria. Díselo en una frase corta.`
      }
    }
    return {
      aviso: { tipo: 'guardado', id: r.id, texto: orden.hecho },
      nota: `Orbe ha guardado esta nota en la memoria del usuario: «${orden.hecho}». Confírmaselo en una frase corta y no la repitas entera.`
    }
  }

  // -------------------------------------------------------------------------------------------
  // Conversación guardada
  // -------------------------------------------------------------------------------------------

  /** Lo que el panel necesita al abrirse: la conversación anterior y, una sola vez, el aviso de la importación. */
  inicioPanel(): InicioMemoria {
    const config = this.almacen.config()
    const bienvenida = config.bienvenida
    if (bienvenida !== null) {
      config.bienvenida = null
      this.almacen.guardarConfig(config)
    }
    return { mensajes: config.activa ? this.conversacion.cargar() : [], bienvenida }
  }

  private prepararHistorial(): void {
    this.historialPendiente = this.activa() ? construirHistorialPrevio(this.conversacion.cargar()) : null
  }

  /** La conversación anterior, para el primer mensaje tras abrir Orbe. No se consume hasta confirmar el envío. */
  tomarHistorialPrevio(): string | null {
    return this.historialPendiente
  }

  confirmarHistorialUsado(): void {
    this.historialPendiente = null
  }

  /** Un intercambio terminó: se guarda para poder seguir mañana. */
  turnoCompletado(usuario: string, asistente: string): void {
    if (!this.activa() || !usuario.trim() || !asistente.trim()) return
    try {
      this.conversacion.anexar(usuario, asistente, this.ahora())
    } catch (error) {
      console.error('[orbe] No se pudo guardar la conversación:', error)
    }
    try {
      this.opciones.alTurno?.(usuario)
    } catch (error) {
      console.error('[orbe] No se pudo anotar el uso de los recuerdos:', error)
    }
  }

  /** «Chat del 12 nov: «tema»»: de qué conversación salió un recuerdo pedido con «Recuerda que…». */
  private fuenteChat(): string {
    const dia = this.ahora().toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
    const mensajes = this.conversacion.cargar()
    return mensajes.length > 0 ? `Chat del ${dia}: «${tituloDe(mensajes)}»` : `Chat del ${dia}`
  }

  /** El historial del chat. */
  historial(): ConversacionArchivada[] {
    return this.conversacion.listar()
  }

  /** Reabre una conversación del historial; el modelo recibe su contexto con el próximo mensaje. */
  abrirHistorial(id: string): MensajeGuardado[] | null {
    const mensajes = this.conversacion.abrir(id, this.ahora())
    if (mensajes) this.historialPendiente = construirHistorialPrevio(mensajes)
    return mensajes
  }

  /** «Nueva conversación»: la actual pasa al historial y se empieza de cero. */
  nuevaConversacion(): void {
    try {
      this.conversacion.archivar(this.ahora())
    } catch (error) {
      console.error('[orbe] No se pudo archivar la conversación:', error)
    }
    this.conversacion.vaciar()
    this.historialPendiente = null
  }
}

/** Lo que viaja de un recuerdo; si lleva meses sin usarse, pierde peso y solo va su resumen. */
function paraPrompt(r: Recuerdo, caducado = false): Parameters<typeof construirBloqueMemoria>[0][number] {
  return {
    id: r.id,
    tipo: r.tipo,
    descripcion: r.descripcion,
    cuerpo: r.cuerpo,
    usar: r.usar,
    completo: r.completo && !caducado,
    modificado: r.modificado
  }
}
