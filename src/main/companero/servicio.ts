import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { AccionBocadillo, ComentarioCompanero, TipoComentario } from '../../shared/companero'
import type { DescripcionPantalla } from '../../shared/vision'
import type { ConfigCompanero } from '../entorno'
import type { VentanaUia } from '../pantalla/contexto'
import { sanearUrl } from '../pantalla/limpieza'
import { ventanaPermitida } from '../vision/ojos'
import { enSilencio, esIntima, esLlamada, esVideo, huellaTexto, MIN, puedeComentar, tituloObra, validarComentario, type Ritmo } from './reglas'
import { mensajeActividad, promptCompanero, type Perfil } from './voz'

export interface DepsCompanero {
  config: ConfigCompanero
  perfil: Perfil
  /** companero.json: «Esto no», apps bloqueadas y lo dicho en 24 h. null = en memoria (humo). */
  archivo: string | null
  ventana(): Promise<VentanaUia | null>
  /** Los ojos (capa de visión, Etapa 13); null si están apagados o no hay permiso. */
  ojos: ((v: VentanaUia) => Promise<DescripcionPantalla | null>) | null
  wikipedia(titulo: string): Promise<string | null>
  modelo(sistema: string, mensaje: string): Promise<string>
  /** Enseña el bocadillo; false si no se pudo (panel abierto, Orbe oculto). */
  mostrar(c: ComentarioCompanero): boolean
  /** Con el panel abierto, Orbe oculto o a batería, calla (o no usa los ojos). */
  ocupado(): boolean
  enBateria(): boolean
  ahora?(): number
}

interface Guardado {
  silenciados: { app: string; tipo: TipoComentario }[]
  /** Además de bancos y gestores (ojos.ts): trozos de proceso, título o web que nunca mira. */
  bloqueadas: string[]
  dichos: { t: number; huella: string }[]
}

const REVISAR_MISMO = 3 * MIN
const ENTRE_IMAGENES = 2 * MIN

/**
 * El bucle del Compañero: cada `intervalo` s mira la ventana (lectura barata), y si cambiaste de actividad o llevas
 * 3 min en lo mismo, pregunta a la voz local si vale la pena decir algo. Nunca actúa: solo propone un bocadillo.
 */
export class Companero {
  private actual: { clave: string; desde: number; revisado: number; descripcion: DescripcionPantalla | null } | null = null
  private ultimaImagen = 0
  private ritmo: Ritmo = { hechos: [], ignorados: 0 }
  private enCurso = false
  private temporizador: NodeJS.Timeout | null = null
  private mostrado: ComentarioCompanero | null = null
  private mostradoEn = 0
  private datos: Guardado

  constructor(private readonly d: DepsCompanero) {
    this.datos = this.leer()
  }

  private ahora(): number {
    return this.d.ahora?.() ?? Date.now()
  }

  private leer(): Guardado {
    const vacio: Guardado = { silenciados: [], bloqueadas: [], dichos: [] }
    if (!this.d.archivo || !existsSync(this.d.archivo)) return vacio
    try {
      return { ...vacio, ...(JSON.parse(readFileSync(this.d.archivo, 'utf8')) as Partial<Guardado>) }
    } catch {
      return vacio
    }
  }

  private guardar(): void {
    if (this.d.archivo) writeFileSync(this.d.archivo, JSON.stringify(this.datos, null, 2), 'utf8')
  }

  iniciar(): void {
    if (!this.d.config.activo || this.temporizador) return
    this.temporizador = setInterval(() => void this.vuelta(), this.d.config.intervalo * 1000)
    this.temporizador.unref?.()
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador)
    this.temporizador = null
  }

  /** Una vuelta del bucle. Devuelve el comentario mostrado (para las pruebas). */
  async vuelta(): Promise<ComentarioCompanero | null> {
    // Si el bocadillo no contestó en 2 min (se cerró la página…), se da por ignorado.
    if (this.mostrado && this.ahora() - this.mostradoEn > 2 * MIN) this.responder(this.mostrado.id, 'ignorado')
    if (this.enCurso || this.mostrado || this.d.ocupado()) return null
    if (enSilencio(this.d.config.silencio, new Date(this.ahora()))) return null
    this.enCurso = true
    try {
      return await this.mirar()
    } catch (e) {
      console.warn('[companero]', e instanceof Error ? e.message : e)
      return null
    } finally {
      this.enCurso = false
    }
  }

  private async mirar(): Promise<ComentarioCompanero | null> {
    const v = await this.d.ventana()
    if (!v || !ventanaPermitida(v) || esLlamada(v) || esIntima(v)) return null
    const todo = `${v.proceso} ${v.titulo} ${v.url ?? ''}`.toLowerCase()
    if (this.datos.bloqueadas.some((b) => b && todo.includes(b.toLowerCase()))) return null

    const web = sanearUrl(v.url)?.url ?? ''
    const clave = `${v.proceso}|${v.titulo}|${web}`
    const ahora = this.ahora()
    // Al cambiar de actividad se espera una vuelta: así no comenta cada ventana por la que pasas con Alt+Tab.
    if (this.actual?.clave !== clave) {
      this.actual = { clave, desde: ahora, revisado: 0, descripcion: null }
      return null
    }
    const act = this.actual
    if (act.revisado && ahora - act.revisado < REVISAR_MISMO) return null
    const pelicula = esVideo(v)
    if (!puedeComentar(this.ritmo, ahora, this.d.config.maxHora, pelicula)) return null
    act.revisado = ahora

    // Ojos: solo si cambió lo que haces, con 2 min entre imágenes y nunca a batería.
    if (this.d.ojos && !act.descripcion && !this.d.enBateria() && ahora - this.ultimaImagen >= ENTRE_IMAGENES) {
      this.ultimaImagen = ahora
      act.descripcion = await this.d.ojos(v).catch(() => null)
      if (act.descripcion?.sensible) return null
    }
    const desc = act.descripcion
    const enVideo = pelicula || desc?.actividad === 'viendo_video'
    const obra = desc?.titulo_obra || (enVideo ? tituloObra(v.titulo) : '')
    const wikipedia = this.d.config.privacidad === 'equilibrada' && obra ? ((await this.d.wikipedia(obra)) ?? '') : ''

    this.datos.dichos = this.datos.dichos.filter((x) => ahora - x.t < 24 * 60 * MIN)
    const app = desc?.app || v.aplicacion || v.proceso
    const respuesta = await this.d.modelo(
      promptCompanero(this.d.perfil),
      mensajeActividad({
        app,
        titulo: v.titulo,
        web,
        descripcion: desc
          ? [desc.que_se_ve, desc.titulo_obra && `Obra: ${desc.titulo_obra}`, desc.textos_visibles.length > 0 && `Textos: ${desc.textos_visibles.join(' · ')}`].filter(Boolean).join(' ')
          : '',
        wikipedia,
        hora: new Date(ahora).toTimeString().slice(0, 5),
        minutos: Math.round((ahora - act.desde) / MIN),
        ultimos: this.textos.slice(-5)
      })
    )
    const p = validarComentario(respuesta)
    if (!p) return null
    if (this.datos.silenciados.some((s) => s.app === app && s.tipo === p.tipo)) return null
    const huella = huellaTexto(p.texto)
    if (this.datos.dichos.some((x) => x.huella === huella)) return null

    const c: ComentarioCompanero = { id: randomUUID(), texto: p.texto, tipo: p.tipo, app, pelicula: enVideo, voz: this.d.config.voz && !enVideo }
    if (!this.d.mostrar(c)) return null
    this.ritmo.hechos = [...this.ritmo.hechos.filter((t) => ahora - t < 60 * MIN), ahora]
    this.datos.dichos.push({ t: ahora, huella })
    this.textos.push(p.texto)
    this.guardar()
    this.mostrado = c
    this.mostradoEn = ahora
    return c
  }

  private textos: string[] = []

  /** Lo que hiciste con el bocadillo. */
  responder(id: string, accion: AccionBocadillo): void {
    const c = this.mostrado
    if (!c || c.id !== id) return
    this.mostrado = null
    if (accion === 'ignorado') {
      this.ritmo.ignorados++
      return
    }
    this.ritmo.ignorados = 0
    if (accion === 'esto_no' && !this.datos.silenciados.some((s) => s.app === c.app && s.tipo === c.tipo)) {
      this.datos.silenciados.push({ app: c.app, tipo: c.tipo })
      this.guardar()
    }
  }
}
