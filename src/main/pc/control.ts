import { DESTINOS_PROHIBIDOS } from '../agente/aplicaciones'
import { AccionProhibida } from '../agente/tipos'

/** Un rectángulo en píxeles físicos de pantalla, como lo da UI Automation. */
export interface RectPc {
  x: number
  y: number
  ancho: number
  alto: number
}

export interface VentanaPc {
  hwnd: number
  proceso: string
  aplicacion: string
  titulo: string
  url?: string | null
  esNavegador?: boolean
  restringida?: boolean
  rect?: RectPc | null
}

export interface ElementoPc {
  n: number
  tipo: string
  nombre: string
  valor?: string | null
  estado: string
  rect: RectPc
}

/** El borde de color mientras Orbe actúa y el recuadro de «Muéstrame cómo». */
export interface MarcoPc {
  mostrar(rect: RectPc | null | undefined): void
  ocultar(): void
  senalar(rect: RectPc, texto: string): void
}

/** Una captura de la ventana en memoria: JPEG base64 y cómo pasar de sus píxeles a la pantalla. */
export interface CapturaPc {
  jpeg: string
  ancho: number
  alto: number
  origen: { x: number; y: number }
  escala: number
}

export interface DepsControlPc {
  /** Una operación del helper de UI Automation (`ClienteHelper.pedir`). */
  pedir<T>(op: string, parametros?: Record<string, unknown>, tiempoMaxMs?: number): Promise<T>
  marco: MarcoPc
  /** El usuario tocó el ratón o el teclado (o pulsó Esc) mientras Orbe actuaba: hay que parar todo. */
  alUsuario(): void
  /** Modo auto: solo se pregunta lo de pagos y compras (lo bloqueado sigue bloqueado). */
  auto?: () => boolean
  /** Captura en memoria de una zona de la pantalla (pc_mirar). Sin ella, el agente no puede mirar la imagen. */
  capturar?: (r: RectPc) => Promise<CapturaPc>
  ahora?: () => number
  esperar?: (ms: number) => Promise<void>
}

/** Consolas, administración, gestores de contraseñas, seguridad de Windows y Orbe mismo: nunca se controlan. */
const PROCESOS_BLOQUEADOS = new Set([
  ...DESTINOS_PROHIBIDOS,
  'powershell_ise', 'windowsterminal', 'openconsole', 'conhost', 'mintty', 'regedit', 'regedt32',
  'sechealthui', 'securityhealthhost', 'securityhealthsystray', 'systemsettings', 'consent', 'credentialuibroker', 'logonui',
  'keepass', 'keepassxc', '1password', 'bitwarden', 'lastpass', 'dashlane', 'enpass', 'roboform', 'nordpass', 'proton pass',
  'orbe'
])

/** Bancos, pagos y gestores de contraseñas en el título o la dirección (también en una pestaña del navegador). */
const DELICADA =
  /\b(banco|bank|banca|bancolombia|davivienda|bbva|scotiabank|colpatria|nequi|daviplata|paypal|stripe|mercado ?pago|pse|wompi|payu|checkout|pasarela de pago|pago seguro|contrase[nñ]as|passwords|bitwarden|1password|lastpass)\b/i

/** Si esa ventana no se puede controlar, por qué (en español, terminado en punto). */
export function motivoBloqueo(v: Pick<VentanaPc, 'proceso' | 'titulo' | 'url' | 'restringida'>): string | undefined {
  if (PROCESOS_BLOQUEADOS.has(v.proceso.toLowerCase())) return `«${v.proceso}» está bloqueada para el control del PC (consolas, administración, contraseñas, seguridad de Windows u Orbe).`
  if (DELICADA.test(`${v.titulo} ${v.url ?? ''}`)) return 'Es una página o app de bancos, pagos o contraseñas: ahí no actúo; hazlo tú.'
  if (v.restringida) return 'Es una ventana de administrador: Windows no deja que Orbe la controle.'
  return undefined
}

/** Botones con efecto: se confirman siempre, aunque la app esté en «libre». */
export const CON_EFECTO =
  /\b(enviar|env[ií]a|send|publicar|publish|post|compartir|share|pagar|pay|comprar|buy|purchase|checkout|eliminar|borrar|delete|remove|suprimir|vaciar|aceptar|confirmar|confirm|ok|s[ií]|yes|instalar|install|desinstalar|uninstall|transferir|firmar|guardar y enviar)\b/i

const TECLAS: Readonly<Record<string, number>> = {
  ctrl: 0x11, control: 0x11, shift: 0x10, mayus: 0x10, alt: 0x12, enter: 0x0d, intro: 0x0d, tab: 0x09, esc: 0x1b,
  escape: 0x1b, espacio: 0x20, space: 0x20, retroceso: 0x08, backspace: 0x08, supr: 0x2e, suprimir: 0x2e, delete: 0x2e,
  del: 0x2e, insert: 0x2d, inicio: 0x24, home: 0x24, fin: 0x23, end: 0x23, repag: 0x21, pageup: 0x21, avpag: 0x22,
  pagedown: 0x22, arriba: 0x26, up: 0x26, abajo: 0x28, down: 0x28, izquierda: 0x25, left: 0x25, derecha: 0x27, right: 0x27
}

/** «Ctrl+Shift+S» → códigos de tecla virtual. La tecla Windows no existe aquí (Win+R abriría «Ejecutar»). */
export function parsearTeclas(combo: string): number[] | null {
  const partes = combo.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split('+').map((p) => p.trim())
  if (partes.length === 0 || partes.length > 4) return null
  const vks: number[] = []
  for (const p of partes) {
    if (TECLAS[p] !== undefined) vks.push(TECLAS[p]!)
    else if (/^[a-z0-9]$/.test(p)) vks.push(p.toUpperCase().charCodeAt(0))
    else if (/^f([1-9]|1\d|2[0-4])$/.test(p)) vks.push(0x6f + Number(p.slice(1)))
    else return null
  }
  return vks
}

/** Teclas que pueden borrar o cerrar (Supr, Alt+F4): se confirman salvo en modo auto. Enter no pregunta. */
export function teclasConEfecto(vks: readonly number[]): boolean {
  return vks.includes(0x2e) || (vks.includes(0x12) && vks.includes(0x73))
}

/** Pagos y compras: se confirman incluso en modo auto. */
export const PAGO = /\b(pagar|pago|pay|comprar|compra|buy|purchase|checkout|transferir|suscrib\w*|subscribe)\b/i

/** La parte de la acción de `reglas.json` que nombra la app: «chrome» → `pc_chrome.control`. */
export function slugApp(proceso: string): string {
  return proceso.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '') || 'app'
}

export const TOPE_ACCIONES = 40
const FIN_SESION_MS = 6000

/**
 * El estado del control del PC: la ventana objetivo, su última lista de elementos y la «sesión» (borde visible y
 * vigilancia del ratón y el teclado mientras Orbe actúa). Las herramientas pasan todas por aquí.
 */
export class ControlPc {
  objetivo: VentanaPc | null = null
  elementos: ElementoPc[] = []
  captura: CapturaPc | null = null
  private activo = false
  private acciones = 0
  private pausadoHasta = 0
  private fin: ReturnType<typeof setTimeout> | null = null
  private readonly ahora: () => number
  readonly esperar: (ms: number) => Promise<void>

  constructor(private readonly deps: DepsControlPc) {
    this.ahora = deps.ahora ?? Date.now
    this.esperar = deps.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  /** Mira la ventana como imagen (apps sin accesibilidad: Blender, juegos, lienzos). Recuerda la escala para pc_clic. */
  async mirar(hwnd?: number): Promise<{ ventana: VentanaPc; captura: CapturaPc }> {
    if (!this.deps.capturar) throw new Error('Mirar la pantalla como imagen no está disponible aquí.')
    const { ventana } = await this.ver(hwnd)
    if (!ventana.rect) throw new Error('No sé dónde está esa ventana en la pantalla.')
    this.captura = await this.deps.capturar(ventana.rect)
    return { ventana, captura: this.captura }
  }

  /** Un punto de la última imagen de pc_mirar, en píxeles de pantalla. */
  enPantalla(x: number, y: number): { x: number; y: number } {
    const c = this.captura
    if (!c) throw new Error('No hay ninguna imagen: mira primero con pc_mirar.')
    if (x < 0 || y < 0 || x > c.ancho || y > c.alto) throw new Error(`Ese punto queda fuera de la imagen (${c.ancho}×${c.alto}).`)
    return { x: Math.round(c.origen.x + x * c.escala), y: Math.round(c.origen.y + y * c.escala) }
  }

  get auto(): boolean {
    return this.deps.auto?.() ?? false
  }

  pedir<T>(op: string, p: Record<string, unknown> = {}, ms?: number): Promise<T> {
    return this.deps.pedir<T>(op, p, ms)
  }

  /** La acción de `reglas.json` para la app objetivo (`pc_chrome.control`), o la general si aún no hay ventana. */
  accion(tipo: 'ver' | 'control'): string {
    return this.objetivo ? `pc_${slugApp(this.objetivo.proceso)}.${tipo}` : `pc.${tipo}`
  }

  elemento(n: number): ElementoPc {
    const e = this.elementos.find((x) => x.n === n)
    if (!this.objetivo || !e) throw new Error(`No tengo el elemento ${n}: mira primero la ventana con pc_ver.`)
    return e
  }

  /** Lee la ventana (la indicada, o la que el usuario usaba) y guarda su lista numerada. */
  async ver(hwnd?: number): Promise<{ ventana: VentanaPc; elementos: ElementoPc[]; parcial: boolean }> {
    const r = await this.pedir<{ ventana: VentanaPc | null; elementos?: ElementoPc[]; parcial?: boolean }>('elementos', hwnd ? { hwnd } : {}, 12_000)
    if (!r.ventana) throw new Error('No hay ninguna ventana abierta que mirar.')
    const motivo = motivoBloqueo(r.ventana)
    if (motivo) {
      this.objetivo = null
      this.elementos = []
      throw new AccionProhibida(motivo)
    }
    if (this.objetivo?.hwnd !== r.ventana.hwnd) this.captura = null
    this.objetivo = r.ventana
    this.elementos = r.elementos ?? []
    return { ventana: r.ventana, elementos: this.elementos, parcial: !!r.parcial }
  }

  /** Antes de cada acción: la ventana sigue siendo controlable (su título pudo cambiar a un banco), y empieza la sesión. */
  async antesDeActuar(preguntar: (titulo: string, detalle: string) => Promise<boolean>): Promise<VentanaPc> {
    if (this.ahora() < this.pausadoHasta) throw new Error('Paré porque el usuario tomó el control del ratón o el teclado. No sigas: espera su orden.')
    if (!this.objetivo) throw new Error('Mira primero la ventana con pc_ver (o elige una con pc_ventanas y pc_enfocar).')
    const r = await this.pedir<{ ventana: VentanaPc | null }>('ventana', { hwnd: this.objetivo.hwnd })
    if (!r.ventana) throw new Error('Esa ventana ya no existe: vuelve a mirar con pc_ver.')
    const motivo = motivoBloqueo(r.ventana)
    if (motivo) throw new AccionProhibida(motivo)
    if (++this.acciones > TOPE_ACCIONES && !this.auto) {
      if (!(await preguntar(`Llevo ${TOPE_ACCIONES} acciones seguidas en el PC. ¿Sigo?`, 'Es el tope de seguridad: si sigues, cuento otras tantas.'))) {
        throw new Error('El usuario no quiso que siga: para y cuéntale dónde te quedaste.')
      }
      this.acciones = 1
    }
    if (this.fin) clearTimeout(this.fin)
    if (!this.activo) {
      this.activo = true
      await this.pedir('vigilar', { activo: 1 })
      this.deps.marco.mostrar(r.ventana.rect)
    }
    return r.ventana
  }

  /** Tras cada acción: espera a que la app reaccione, relee la ventana y deja la sesión abierta unos segundos. */
  async despues(): Promise<string> {
    this.fin = setTimeout(() => void this.terminar(), FIN_SESION_MS)
    await this.esperar(400)
    const v = await this.ver(this.objetivo!.hwnd)
    return `Ventana ahora (los números cambian, usa estos):\n${formatearLista(v.ventana, v.elementos, v.parcial)}`
  }

  async terminar(): Promise<void> {
    if (this.fin) clearTimeout(this.fin)
    this.fin = null
    if (!this.activo) return
    this.activo = false
    this.acciones = 0
    this.deps.marco.ocultar()
    await this.pedir('vigilar', { activo: 0 }).catch(() => undefined)
  }

  /** El helper avisó de que el usuario movió el ratón o tocó una tecla: se para todo y se le devuelve el control. */
  usuarioIntervino(): void {
    if (!this.activo) return
    this.pausadoHasta = this.ahora() + 5000
    void this.terminar()
    this.deps.alUsuario()
  }

  senalar(e: ElementoPc, texto: string): void {
    this.deps.marco.senalar(e.rect, texto)
  }
}

const centro = (r: RectPc): string => `${Math.round(r.x + r.ancho / 2)},${Math.round(r.y + r.alto / 2)}`

/** La ventana como texto para el modelo: una línea por elemento, con su número. */
export function formatearLista(v: VentanaPc, elementos: readonly ElementoPc[], parcial: boolean): string {
  const cabecera = `Ventana: ${v.aplicacion} — «${v.titulo}»${v.url ? ` (${v.url})` : ''} [hwnd ${v.hwnd}]`
  if (elementos.length === 0) {
    return `${cabecera}\nEsta aplicación no expone sus elementos (accesibilidad): no puedo controlarla con seguridad. Pídele al usuario que lo haga él.`
  }
  const lineas = elementos.map(
    (e) =>
      `[${e.n}] ${e.tipo}${e.nombre ? ` «${e.nombre}»` : ''}${e.valor ? ` = «${e.valor}»` : ''}${e.estado ? ` (${e.estado})` : ''} en ${centro(e.rect)}`
  )
  return [cabecera, ...lineas, ...(parcial ? ['(lista recortada: hay más elementos; desplázate o enfoca una parte)'] : [])].join('\n')
}
