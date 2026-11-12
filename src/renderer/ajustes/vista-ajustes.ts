import { esIdIdentidad, perfilDe, type ConfigIdentidad } from '../../shared/identidad'
import { DISENOS } from '../../shared/disenos'
import type { Apariencia, ClaveNueva, ConfigVista, PeticionConfig } from '../../shared/tipos'
import { SECRETOS, type DefinicionSecreto, type EstadoCofre, type ResultadoCofre } from '../../shared/cofre'
import { crearIcono } from '../chat/contexto-ui'

type Proveedor = 'cli' | 'api' | 'openai'

interface Preajuste {
  id: string
  nombre: string
  url: string
  modelo: string
  /** Solo en voz: la voz por defecto del servicio. */
  voz?: string
  nota?: string
}

const MODELO_CLAUDE = 'claude-sonnet-5-5'
const URL_OPENAI = 'https://api.openai.com/v1'

const PREAJUSTES_CHAT: Preajuste[] = [
  { id: 'groq', nombre: 'Groq (con plan gratuito)', url: 'https://api.groq.com/openai/v1', modelo: 'llama-3.3-70b-versatile', nota: 'Los modelos de solo texto no ven imágenes: la captura de pantalla no les sirve.' },
  { id: 'gemini', nombre: 'Google AI Studio (Gemini, con plan gratuito)', url: 'https://generativelanguage.googleapis.com/v1beta/openai', modelo: 'gemini-3.5-flash', nota: 'Crea la clave gratis en aistudio.google.com (Get API key). Ve imágenes y admite el modo agente. Otro modelo: «gemini-3.8-flash» (más nuevo, a veces saturado). Los alias «…-latest» y la serie 2.5 no funcionan aquí, y los Pro casi no tienen cuota en el plan gratuito.' },
  { id: 'nvidia', nombre: 'NVIDIA', url: 'https://integrate.api.nvidia.com/v1', modelo: 'moonshotai/kimi-k3' },
  { id: 'openrouter', nombre: 'OpenRouter', url: 'https://openrouter.ai/api/v1', modelo: '', nota: 'Escribe el nombre exacto del modelo (los gratuitos acaban en «:free»).' },
  { id: 'openai', nombre: 'OpenAI', url: URL_OPENAI, modelo: 'gpt-4o-mini' },
  { id: 'ollama', nombre: 'Ollama (en tu PC, gratis)', url: 'http://localhost:11434/v1', modelo: 'llama3.1', nota: 'No necesita clave. Ollama tiene que estar abierto.' },
  { id: 'lmstudio', nombre: 'LM Studio (en tu PC, gratis)', url: 'http://localhost:1234/v1', modelo: '', nota: 'No necesita clave. Activa el servidor local en LM Studio.' },
  { id: 'otro', nombre: 'Otro servicio compatible con OpenAI', url: '', modelo: '' }
]

const PREAJUSTES_DICTADO: Preajuste[] = [
  { id: 'groq', nombre: 'Groq (con plan gratuito)', url: 'https://api.groq.com/openai/v1', modelo: 'whisper-large-v3-turbo' },
  { id: 'openai', nombre: 'OpenAI', url: URL_OPENAI, modelo: 'whisper-1' },
  { id: 'local', nombre: 'Whisper en tu PC (servidor compatible)', url: 'http://localhost:8000/v1', modelo: 'Systran/faster-whisper-small', nota: 'No necesita clave.' },
  { id: 'otro', nombre: 'Otro servicio compatible con OpenAI', url: '', modelo: '' }
]

const PREAJUSTES_VOZ: Preajuste[] = [
  { id: 'openai', nombre: 'OpenAI', url: URL_OPENAI, modelo: 'gpt-4o-mini-tts', voz: 'onyx', nota: 'Es de pago (céntimos por respuesta). Suena muy natural y entiende el estilo «Jarvis».' },
  { id: 'kokoro', nombre: 'Kokoro en tu PC (gratis)', url: 'http://localhost:8880/v1', modelo: 'kokoro', voz: 'em_alex', nota: 'Servidor Kokoro-FastAPI en tu PC, sin clave. Voz en español: em_alex (hombre) o ef_dora (mujer).' },
  { id: 'otro', nombre: 'Otro servicio compatible con OpenAI', url: '', modelo: '', voz: '' }
]

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (clase) e.className = clase
  if (texto !== undefined) e.textContent = texto
  return e
}

/** El preajuste que corresponde a una dirección (una dirección vacía es la de OpenAI). */
export function detectarPreajuste(lista: Preajuste[], url: string, vacio: string): string {
  const u = url.trim().replace(/\/+$/, '')
  if (!u) return vacio
  return lista.find((p) => p.url && p.url.replace(/\/+$/, '') === u)?.id ?? 'otro'
}

interface Borrador {
  proveedor: Proveedor
  modelo: string
  openaiUrl: string
  openaiKey: ClaveNueva
  anthropicKey: ClaveNueva
  dictado: { url: string; modelo: string; idioma: string; clave: ClaveNueva }
  voz: { url: string; modelo: string; voz: string; clave: ClaveNueva }
  apariencia: Apariencia
  diseno: string
  riveArchivo: string
  eventos: boolean
  identidad: ConfigIdentidad
}

/**
 * La pantalla de configuración: qué IA responde (el CLI de Claude, la API de Anthropic u otro servicio compatible con
 * OpenAI), de dónde sale el dictado y qué voz neuronal lee las respuestas. Las claves solo viajan de aquí al proceso
 * principal, que las guarda en el .env: nunca vuelven a la pantalla.
 */
export type Aparte = 'uso' | 'memoria' | 'voz' | 'fondo'
/** Secciones que viven fuera de Configuración pero se abren desde su lista. */
const APARTES: Array<{ que: Aparte; nombre: string; detalle: string; icono: Parameters<typeof crearIcono>[0] }> = [
  { que: 'uso', nombre: 'Consumo', detalle: 'Tokens y dinero gastados', icono: 'consumo' },
  { que: 'memoria', nombre: 'Memoria', detalle: 'Lo que Orbe sabe de ti', icono: 'libro' },
  { que: 'voz', nombre: 'Voz y dictado', detalle: 'Leer en voz alta y enviar al dictar', icono: 'altavoz' },
  { que: 'fondo', nombre: 'Fondo del chat', detalle: 'Elegir imagen, cambiarla o apagarla', icono: 'imagen' }
]

export class VistaAjustes {
  private vista: ConfigVista | null = null
  private borrador: Borrador | null = null
  private mensaje: { texto: string; error: boolean } | null = null
  private guardando = false
  /** El grupo abierto (0…5) o null para ver la lista de grupos: así no está todo en una sola lista larga. */
  private grupo: number | null = null
  /** Qué hay en el cofre (solo sí o no por clave: los valores nunca llegan a la interfaz). */
  private cofre: EstadoCofre | null = null
  private cofreMensaje: { texto: string; error: boolean } | null = null
  /** La clave cuyo «Borrar» ya se pulsó una vez (el segundo clic borra). */
  private borrarPendiente: string | null = null
  private cofreOcupado = false
  private conectandoGmail = false

  constructor(
    private readonly raiz: HTMLElement,
    private readonly alVolver: () => void,
    /** Lo que antes estaba en la barra lateral y ahora se abre desde aquí. */
    private readonly alAbrirAparte: (que: Aparte) => void = () => {}
  ) {}

  get visible(): boolean {
    return !this.raiz.hidden
  }

  async abrir(): Promise<void> {
    this.raiz.hidden = false
    this.mensaje = null
    this.guardando = false
    this.cofreMensaje = null
    this.borrarPendiente = null
    try {
      this.cofre = await window.orbe.cofreEstado()
    } catch {
      this.cofre = { disponible: false, error: 'No he podido consultar el cofre.', guardados: {} }
    }
    try {
      this.vista = await window.orbe.configLeer()
      const v = this.vista
      this.borrador = {
        proveedor: v.proveedor,
        modelo: v.modelo,
        openaiUrl: v.openaiUrl,
        openaiKey: undefined,
        anthropicKey: undefined,
        dictado: { url: v.dictado.url, modelo: v.dictado.modelo, idioma: v.dictado.idioma, clave: undefined },
        voz: { url: v.voz.url, modelo: v.voz.modelo, voz: v.voz.voz, clave: undefined },
        apariencia: v.apariencia,
        diseno: v.diseno,
        riveArchivo: v.riveArchivo,
        eventos: v.eventos,
        identidad: { ...v.identidad }
      }
      this.pintar()
    } catch {
      this.raiz.replaceChildren(el('p', 'memoria-nota', 'No he podido leer la configuración.'))
    }
  }

  cerrar(): void {
    this.raiz.hidden = true
    this.borrador = null
    this.grupo = null
  }

  /** Lo que hay puesto en cada grupo, en una línea (para la lista de grupos). */
  private resumenes(b: Borrador): string[] {
    const quien = { cli: 'CLI de Claude', api: 'API de Anthropic', openai: 'Otra IA compatible' }[b.proveedor]
    const host = (url: string): string => {
      try {
        return new URL(url).host
      } catch {
        return ''
      }
    }
    const figura = { '3d': 'Conejo 3D', personaje: 'Personaje dibujado', rive: 'Personaje de Rive', orbe: 'Orbe clásico' }[b.apariencia as string] ?? b.apariencia
    return [
      `${quien}${b.modelo ? ` · ${b.modelo}` : ''}`,
      `${figura} · avisos de Claude Code ${b.eventos ? 'activados' : 'apagados'}`,
      b.dictado.url ? `${host(b.dictado.url)} · ${b.dictado.modelo}` : 'Sin configurar',
      b.voz.url ? `${host(b.voz.url)} · ${b.voz.voz || b.voz.modelo}` : 'Voces de Windows',
      b.identidad.id === 'orbe' ? 'Orbe (cercano, de tú)' : `${perfilDe(b.identidad).nombre} · trata de «${perfilDe(b.identidad).trato}»`,
      this.resumenCofre()
    ]
  }

  private resumenCofre(): string {
    if (!this.cofre?.disponible) return 'Cofre no disponible'
    const n = SECRETOS.filter((s) => this.cofre?.guardados[s.clave]).length
    return n === 0 ? 'Cofre cifrado · nada guardado' : `Cofre cifrado · ${n} ${n === 1 ? 'secreto guardado' : 'secretos guardados'}`
  }

  /**
   * Conectores: cada secreto se guarda o se borra al momento (sin reiniciar). El campo es de contraseña, se vacía
   * nada más pulsar Guardar y nunca se rellena con lo guardado: la interfaz solo sabe si hay algo o no.
   */
  private seccionConectores(): HTMLElement[] {
    const estado = this.cofre
    const hijos: HTMLElement[] = []
    if (!estado?.disponible) {
      hijos.push(el('p', 'memoria-error', estado?.error ?? 'El cofre no está disponible.'))
      return hijos
    }
    const servicios = [...new Set(SECRETOS.map((s) => s.servicio))]
    for (const servicio of servicios) {
      hijos.push(el('h4', 'cofre-servicio', servicio))
      for (const def of SECRETOS.filter((s) => s.servicio === servicio)) hijos.push(this.filaSecreto(def, estado.guardados[def.clave] === true))
    }
    if (this.cofreMensaje) hijos.push(el('p', this.cofreMensaje.error ? 'memoria-error' : 'memoria-nota', this.cofreMensaje.texto))
    hijos.push(
      el(
        'p',
        'memoria-nota',
        'Se cifran con el cifrado de Windows (DPAPI), ligado a tu usuario, en cofre.bin. Orbe nunca los enseña, ni aquí ni en el chat, ni los manda al modelo. Si los copiaste, el portapapeles se vacía al guardar.'
      )
    )
    return hijos
  }

  private filaSecreto(def: DefinicionSecreto, guardado: boolean): HTMLElement {
    const fila = el('div', 'cofre-fila')
    fila.dataset['clave'] = def.clave
    const cabeza = el('div', 'cofre-cabeza')
    cabeza.append(el('span', 'ajuste-etiqueta', def.nombre), el('span', `cofre-estado${guardado ? ' guardado' : ''}`, guardado ? 'Guardado' : 'Sin guardar'))
    fila.append(cabeza)
    const caja = el('div', 'ajuste-clave')
    if (def.manual) {
      const entrada = el('input', 'memoria-campo')
      entrada.type = 'password'
      entrada.autocomplete = 'off'
      entrada.spellcheck = false
      entrada.setAttribute('aria-label', def.nombre)
      entrada.placeholder = guardado ? 'Pega uno nuevo para sustituirlo' : 'Pega aquí el valor'
      const guardar = el('button', 'boton-memoria primario', 'Guardar')
      guardar.type = 'button'
      guardar.disabled = this.cofreOcupado
      const enviar = (): void => {
        const valor = entrada.value
        // El valor sale del campo una sola vez: se vacía antes de enviarlo.
        entrada.value = ''
        if (valor) void this.cofreAccion(() => window.orbe.cofreGuardar(def.clave, valor), `${def.nombre}: guardado y cifrado.`)
      }
      guardar.addEventListener('click', enviar)
      entrada.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') enviar()
      })
      caja.append(entrada, guardar)
    } else if (def.clave === 'gmail.refresh') {
      // Gmail no se pega: se da el permiso en el navegador y Orbe lo guarda solo.
      const conectar = el('button', 'boton-memoria primario', this.conectandoGmail ? 'Cancelar' : guardado ? 'Volver a conectar' : 'Conectar')
      conectar.type = 'button'
      conectar.disabled = this.cofreOcupado && !this.conectandoGmail
      conectar.addEventListener('click', () => {
        // Si Google da un error en el navegador, nunca vuelve: se puede dejar de esperar.
        if (this.conectandoGmail) return window.orbe.gmailCancelar()
        this.conectandoGmail = true
        void this.cofreAccion(
          () => window.orbe.gmailConectar(),
          'Gmail conectado: Orbe puede leer tu correo y crear borradores (no enviar).',
          'Termina en tu navegador: elige tu cuenta de Google y marca los dos permisos.'
        ).finally(() => {
          this.conectandoGmail = false
          this.pintar()
        })
      })
      caja.append(conectar)
    }
    if (guardado) {
      const pendiente = this.borrarPendiente === def.clave
      const borrar = el('button', 'boton-memoria peligro', pendiente ? '¿Seguro? Pulsa otra vez' : def.manual ? 'Borrar' : 'Revocar')
      borrar.type = 'button'
      borrar.disabled = this.cofreOcupado
      borrar.addEventListener('click', () => {
        if (!pendiente) {
          this.borrarPendiente = def.clave
          this.pintar()
          return
        }
        this.borrarPendiente = null
        void this.cofreAccion(() => window.orbe.cofreBorrar(def.clave), `${def.nombre}: borrado del cofre.`)
      })
      caja.append(borrar)
    }
    if (caja.childElementCount > 0) fila.append(caja)
    fila.append(el('span', 'ajuste-ayuda', def.ayuda))
    return fila
  }

  private async cofreAccion(accion: () => Promise<ResultadoCofre>, exito: string, mientras?: string): Promise<void> {
    if (this.cofreOcupado) return
    this.cofreOcupado = true
    this.cofreMensaje = mientras ? { texto: mientras, error: false } : null
    this.pintar()
    try {
      const r = await accion()
      this.cofre = r.estado
      this.cofreMensaje = r.ok ? { texto: exito, error: false } : { texto: r.error, error: true }
    } catch {
      this.cofreMensaje = { texto: 'No se pudo hablar con el cofre.', error: true }
    }
    this.cofreOcupado = false
    this.pintar()
  }

  // -------------------------------------------------------------------------------------------
  // Piezas
  // -------------------------------------------------------------------------------------------

  private campo(etiqueta: string, entrada: HTMLElement, ayuda?: string): HTMLElement {
    const f = el('label', 'ajuste-campo')
    f.append(el('span', 'ajuste-etiqueta', etiqueta), entrada)
    if (ayuda) f.append(el('span', 'ajuste-ayuda', ayuda))
    return f
  }

  private texto(valor: string, alCambiar: (v: string) => void, placeholder = '', etiqueta = ''): HTMLInputElement {
    const i = el('input', 'memoria-campo')
    i.type = 'text'
    i.value = valor
    i.placeholder = placeholder
    i.spellcheck = false
    i.autocomplete = 'off'
    if (etiqueta) i.setAttribute('aria-label', etiqueta)
    i.addEventListener('input', () => alCambiar(i.value))
    return i
  }

  private selector(opciones: { id: string; nombre: string }[], actual: string, alCambiar: (id: string) => void, etiqueta: string): HTMLSelectElement {
    const s = el('select', 'voz-selector')
    s.setAttribute('aria-label', etiqueta)
    for (const o of opciones) {
      const op = el('option', undefined, o.nombre)
      op.value = o.id
      op.selected = o.id === actual
      s.append(op)
    }
    s.addEventListener('change', () => alCambiar(s.value))
    return s
  }

  /** Campo de clave: nunca enseña la guardada; en blanco la mantiene y la casilla la quita. */
  private campoClave(etiqueta: string, existe: boolean, valor: ClaveNueva, alCambiar: (v: ClaveNueva) => void): HTMLElement {
    const i = el('input', 'memoria-campo')
    i.type = 'password'
    i.autocomplete = 'off'
    i.spellcheck = false
    i.setAttribute('aria-label', etiqueta)
    i.placeholder = existe ? 'Guardada · en blanco para mantenerla' : 'Pega aquí la clave'
    i.value = typeof valor === 'string' ? valor : ''
    i.disabled = valor === null
    i.addEventListener('input', () => alCambiar(i.value === '' ? undefined : i.value))
    const caja = el('div', 'ajuste-clave')
    caja.append(i)
    if (existe) {
      const quitar = el('label', 'memoria-opcion')
      const marca = el('input')
      marca.type = 'checkbox'
      marca.checked = valor === null
      marca.addEventListener('change', () => {
        alCambiar(marca.checked ? null : undefined)
        i.disabled = marca.checked
        if (marca.checked) i.value = ''
      })
      quitar.append(marca, el('span', undefined, 'Quitar la clave guardada'))
      caja.append(quitar)
    }
    return this.campo(etiqueta, caja)
  }

  private seccion(titulo: string, ...hijos: (HTMLElement | null)[]): HTMLElement {
    const s = el('section', 'ajuste-seccion')
    s.append(el('h3', 'ajuste-titulo', titulo))
    for (const h of hijos) if (h) s.append(h)
    return s
  }

  // -------------------------------------------------------------------------------------------
  // Pintado
  // -------------------------------------------------------------------------------------------

  private pintar(): void {
    const b = this.borrador
    const v = this.vista
    if (!b || !v) return
    const desplazamiento = this.raiz.querySelector('.memoria-cuerpo')?.scrollTop ?? 0

    const cabecera = el('div', 'memoria-cabecera')
    const volver = el('button', 'boton-icono')
    volver.type = 'button'
    volver.title = 'Volver al chat'
    volver.setAttribute('aria-label', 'Volver al chat')
    volver.append(crearIcono('volver', 18))
    const grupos = ['Inteligencia', 'Personaje y avisos', 'Dictado (micrófono)', 'Voz neuronal', 'Identidad', 'Conectores']
    const GRUPO_CONECTORES = 5
    volver.addEventListener('click', () => {
      if (this.grupo === null) this.alVolver()
      else {
        this.grupo = null
        this.pintar()
      }
    })
    cabecera.append(volver, el('span', 'memoria-titulo', this.grupo === null ? 'Configuración' : grupos[this.grupo]))

    const cuerpo = el('div', 'memoria-cuerpo ajustes-cuerpo')

    // --- Quién responde ---
    const proveedor = this.selector(
      [
        { id: 'cli', nombre: 'Claude con el CLI de Claude (tu sesión, sin clave)' },
        { id: 'api', nombre: 'Claude con la API de Anthropic (con clave)' },
        { id: 'openai', nombre: 'Otra IA compatible con OpenAI (Google AI Studio, Groq, NVIDIA, Ollama…)' }
      ],
      b.proveedor,
      (id) => {
        b.proveedor = id as Proveedor
        if (b.proveedor !== 'openai' && !b.modelo.startsWith('claude')) b.modelo = MODELO_CLAUDE
        if (b.proveedor === 'openai' && b.modelo.startsWith('claude')) {
          const p = PREAJUSTES_CHAT.find((x) => x.id === detectarPreajuste(PREAJUSTES_CHAT, b.openaiUrl, 'openai'))
          b.modelo = p?.modelo ?? ''
        }
        this.pintar()
      },
      'Quién responde'
    )
    const responde: (HTMLElement | null)[] = [this.campo('Quién responde', proveedor)]
    if (b.proveedor === 'cli') {
      responde.push(this.campo('Modelo', this.texto(b.modelo, (x) => (b.modelo = x), MODELO_CLAUDE, 'Modelo'), 'Usa tu plan de Claude: hace falta tener el CLI instalado y la sesión iniciada.'))
    } else if (b.proveedor === 'api') {
      responde.push(
        this.campo('Modelo', this.texto(b.modelo, (x) => (b.modelo = x), MODELO_CLAUDE, 'Modelo')),
        this.campoClave('Clave de Anthropic', v.tieneClaveAnthropic, b.anthropicKey, (x) => (b.anthropicKey = x))
      )
    } else {
      const id = detectarPreajuste(PREAJUSTES_CHAT, b.openaiUrl, 'openai')
      const preajuste = this.selector(PREAJUSTES_CHAT, id, (nuevo) => {
        const p = PREAJUSTES_CHAT.find((x) => x.id === nuevo)!
        if (nuevo !== 'otro') {
          b.openaiUrl = p.url
          b.modelo = p.modelo
        }
        this.pintar()
      }, 'Servicio')
      responde.push(
        this.campo('Servicio', preajuste, PREAJUSTES_CHAT.find((x) => x.id === id)?.nota),
        this.campo('Dirección (URL)', this.texto(b.openaiUrl, (x) => (b.openaiUrl = x), URL_OPENAI, 'Dirección del servicio')),
        this.campo('Modelo', this.texto(b.modelo, (x) => (b.modelo = x), 'nombre del modelo', 'Modelo')),
        this.campoClave('Clave del servicio', v.tieneClaveOpenai, b.openaiKey, (x) => (b.openaiKey = x))
      )
    }

    // --- Dictado ---
    const idDictado = b.dictado.url || b.dictado.modelo ? detectarPreajuste(PREAJUSTES_DICTADO, b.dictado.url, 'openai') : 'ninguno'
    const dictado = this.selector([{ id: 'ninguno', nombre: 'Sin configurar' }, ...PREAJUSTES_DICTADO], idDictado, (nuevo) => {
      if (nuevo === 'ninguno') {
        b.dictado = { url: '', modelo: '', idioma: '', clave: v.dictado.tieneClave ? null : undefined }
      } else {
        const p = PREAJUSTES_DICTADO.find((x) => x.id === nuevo)!
        if (nuevo !== 'otro') {
          b.dictado.url = p.url
          b.dictado.modelo = p.modelo
        }
        if (b.dictado.clave === null) b.dictado.clave = undefined
        if (!b.dictado.idioma) b.dictado.idioma = 'es'
      }
      this.pintar()
    }, 'Servicio de dictado')
    const secDictado: (HTMLElement | null)[] = [this.campo('Servicio', dictado, PREAJUSTES_DICTADO.find((x) => x.id === idDictado)?.nota)]
    if (idDictado !== 'ninguno') {
      secDictado.push(
        this.campo('Dirección (URL)', this.texto(b.dictado.url, (x) => (b.dictado.url = x), URL_OPENAI, 'Dirección del dictado')),
        this.campo('Modelo', this.texto(b.dictado.modelo, (x) => (b.dictado.modelo = x), 'whisper-1', 'Modelo del dictado')),
        this.campo('Idioma', this.texto(b.dictado.idioma, (x) => (b.dictado.idioma = x), 'es', 'Idioma del dictado')),
        this.campoClave('Clave del dictado', v.dictado.tieneClave, b.dictado.clave, (x) => (b.dictado.clave = x))
      )
    }

    // --- Voz neuronal ---
    const idVoz = b.voz.url || b.voz.modelo ? detectarPreajuste(PREAJUSTES_VOZ, b.voz.url, 'openai') : 'ninguno'
    const voz = this.selector([{ id: 'ninguno', nombre: 'Sin configurar (voces de Windows)' }, ...PREAJUSTES_VOZ], idVoz, (nuevo) => {
      if (nuevo === 'ninguno') {
        b.voz = { url: '', modelo: '', voz: '', clave: v.voz.tieneClave ? null : undefined }
      } else {
        const p = PREAJUSTES_VOZ.find((x) => x.id === nuevo)!
        if (nuevo !== 'otro') {
          b.voz.url = p.url
          b.voz.modelo = p.modelo
          b.voz.voz = p.voz ?? ''
        }
        if (b.voz.clave === null) b.voz.clave = undefined
      }
      this.pintar()
    }, 'Servicio de voz')
    const secVoz: (HTMLElement | null)[] = [this.campo('Servicio', voz, PREAJUSTES_VOZ.find((x) => x.id === idVoz)?.nota)]
    if (idVoz !== 'ninguno') {
      secVoz.push(
        this.campo('Dirección (URL)', this.texto(b.voz.url, (x) => (b.voz.url = x), URL_OPENAI, 'Dirección de la voz')),
        this.campo('Modelo', this.texto(b.voz.modelo, (x) => (b.voz.modelo = x), 'gpt-4o-mini-tts', 'Modelo de la voz')),
        this.campo('Voz', this.texto(b.voz.voz, (x) => (b.voz.voz = x), 'onyx', 'Voz')),
        this.campoClave('Clave de la voz', v.voz.tieneClave, b.voz.clave, (x) => (b.voz.clave = x)),
        el('p', 'memoria-nota', 'Con la voz neuronal, el texto de las respuestas viaja a este servicio. Actívala desde el altavoz de la cabecera (motor de voz).')
      )
    }

    // --- Personaje y avisos ---
    const apariencia = this.selector(
      [
        { id: '3d', nombre: 'Personaje 3D (el conejo)' },
        { id: 'personaje', nombre: 'Personaje dibujado (20 diseños)' },
        { id: 'rive', nombre: 'Personaje de Rive (archivo .riv)' },
        { id: 'orbe', nombre: 'Orbe clásico (sin cara)' }
      ],
      b.apariencia,
      (nuevo) => {
        b.apariencia = nuevo as Apariencia
        this.pintar()
      },
      'Figura de la esquina'
    )
    const secPersonaje: (HTMLElement | null)[] = [this.campo('Figura', apariencia)]
    if (b.apariencia === 'personaje') {
      const diseno = this.selector(
        DISENOS.map((d, i) => ({ id: d.id, nombre: `${i + 1}. ${d.nombre}` })),
        b.diseno,
        (nuevo) => (b.diseno = nuevo),
        'Diseño del personaje'
      )
      secPersonaje.push(this.campo('Diseño', diseno, 'Las 20 expresiones funcionan con todos.'))
    }
    if (b.apariencia === 'rive') {
      const fila = el('div', 'ajuste-clave')
      const ruta = this.texto(b.riveArchivo, (x) => (b.riveArchivo = x), 'C:\\ruta\\personaje.riv', 'Archivo .riv')
      const elegir = el('button', 'boton-memoria', 'Elegir…')
      elegir.type = 'button'
      elegir.addEventListener('click', () => {
        void window.orbe.configElegirRive().then((r) => {
          if (r) {
            b.riveArchivo = r
            this.pintar()
          }
        })
      })
      fila.append(ruta, elegir)
      secPersonaje.push(
        this.campo('Archivo .riv', fila),
        el(
          'p',
          'memoria-nota',
          'Hecho en rive.app. Orbe mueve estas entradas de su máquina de estados: expresion (0–19), estado (0–5), mirarX y mirarY (-100…100), pulso y tocar (disparadores) y hablando (reservada para la voz). Si el archivo falla, se usa el personaje de siempre.'
        )
      )
    }
    const eventos = el('label', 'memoria-opcion')
    const marcaEventos = el('input')
    marcaEventos.type = 'checkbox'
    marcaEventos.checked = b.eventos
    marcaEventos.setAttribute('aria-label', 'Avisos de Claude Code y otras herramientas')
    marcaEventos.addEventListener('change', () => (b.eventos = marcaEventos.checked))
    eventos.append(marcaEventos, el('span', undefined, 'Avisos de Claude Code y otras herramientas'))
    secPersonaje.push(
      eventos,
      el(
        'p',
        'memoria-nota',
        'Abre un receptor solo en este equipo (127.0.0.1, con un token secreto) para que Claude Code, n8n o tus scripts avisen a Orbe: el personaje pone cara y los ves en «Actividad». No da acceso a Orbe ni ejecuta nada.'
      )
    )

    // --- Identidad ---
    const identidad = this.selector(
      [
        { id: 'orbe', nombre: 'Orbe: asistente cercano (de tú)' },
        { id: 'atlas', nombre: 'Atlas: mayordomo digital con identidad propia (de usted)' }
      ],
      b.identidad.id,
      (nuevo) => {
        b.identidad.id = esIdIdentidad(nuevo) ? nuevo : 'orbe'
        this.pintar()
      },
      'Identidad'
    )
    const secIdentidad: (HTMLElement | null)[] = [this.campo('Quién habla', identidad)]
    if (b.identidad.id !== 'orbe') {
      const p = perfilDe(b.identidad)
      secIdentidad.push(
        this.campo('Nombre', this.texto(b.identidad.nombre, (x) => (b.identidad.nombre = x), p.nombre, 'Nombre de la identidad'), 'Déjalo en blanco para usar el suyo.'),
        this.campo('Cómo te llama', this.texto(b.identidad.trato, (x) => (b.identidad.trato = x), p.trato, 'Trato'), 'Por ejemplo «señor», «jefe» o tu nombre.'),
        el(
          'p',
          'memoria-nota',
          'Atlas tiene carácter propio: sereno, leal, con humor seco y franco con tacto. Al abrir el panel por primera vez cada día te da el parte de situación. Escribe «parte» para pedirlo y «protocolo <nombre>» para lanzar una de tus tareas. Los permisos no cambian.'
        )
      )
    }

    const secciones = [
      this.seccion('Quién responde', ...responde),
      this.seccion('Personaje y avisos', ...secPersonaje),
      this.seccion('Dictado (micrófono)', ...secDictado),
      this.seccion('Voz neuronal (leer en voz alta)', ...secVoz),
      this.seccion('Identidad', ...secIdentidad),
      this.seccion('Conectores · cofre cifrado', ...this.seccionConectores())
    ]
    secciones[GRUPO_CONECTORES]!.classList.add('ajustes-conectores')
    // Todas las secciones siguen en la página (lo que cambies en una no se pierde al ir a otra), pero solo se ve
    // la del grupo abierto; sin grupo abierto se ve la lista de grupos con lo que tiene puesto cada uno.
    secciones.forEach((sec, i) => (sec.hidden = this.grupo !== i))
    if (this.grupo === null) {
      const lista = el('div', 'ajustes-grupos')
      const iconos = ['chip', 'conejo', 'micro', 'altavoz', 'sombrero', 'candado'] as const
      const resumen = this.resumenes(b)
      grupos.forEach((nombre, i) => {
        const g = el('button', 'ajustes-grupo')
        g.type = 'button'
        g.dataset['grupo'] = String(i)
        const texto = el('span', 'ajustes-grupo-texto')
        texto.append(el('strong', undefined, nombre), el('small', undefined, resumen[i]))
        const icono = el('span', 'ajustes-grupo-icono')
        icono.append(crearIcono(iconos[i], 16))
        g.append(icono, texto, el('span', 'ajustes-grupo-flecha', '›'))
        g.addEventListener('click', () => {
          this.grupo = i
          this.pintar()
          this.raiz.querySelector('.memoria-cuerpo')?.scrollTo(0, 0)
        })
        lista.append(g)
      })
      for (const a of APARTES) {
        const g = el('button', 'ajustes-grupo')
        g.type = 'button'
        g.dataset['aparte'] = a.que
        const texto = el('span', 'ajustes-grupo-texto')
        texto.append(el('strong', undefined, a.nombre), el('small', undefined, a.detalle))
        const icono = el('span', 'ajustes-grupo-icono')
        icono.append(crearIcono(a.icono, 16))
        g.append(icono, texto, el('span', 'ajustes-grupo-flecha', '›'))
        g.addEventListener('click', (e) => {
          // Los menús de voz y fondo se cierran con un clic fuera: este clic no debe llegar a cerrarlos.
          e.stopPropagation()
          this.alAbrirAparte(a.que)
        })
        lista.append(g)
      }
      cuerpo.append(lista)
    }
    cuerpo.append(...secciones)

    // --- Acciones ---
    const acciones = el('div', 'memoria-acciones')
    const guardar = el('button', 'boton-memoria primario', this.guardando ? 'Guardando…' : 'Guardar y reiniciar Orbe')
    guardar.type = 'button'
    guardar.disabled = this.guardando
    guardar.addEventListener('click', () => void this.guardar())
    const cancelar = el('button', 'boton-memoria', 'Cancelar')
    cancelar.type = 'button'
    cancelar.addEventListener('click', () => this.alVolver())
    acciones.append(guardar, cancelar)
    // En Conectores cada secreto se guarda en el momento: el botón de reiniciar no pinta nada ahí.
    if (this.grupo !== GRUPO_CONECTORES) {
      cuerpo.append(acciones)
      if (this.mensaje) cuerpo.append(el('p', this.mensaje.error ? 'memoria-error' : 'memoria-nota', this.mensaje.texto))
      cuerpo.append(
        el('p', 'memoria-nota', 'Las claves se guardan en el archivo .env de tu equipo y nunca vuelven a mostrarse aquí. Al guardar, Orbe se reinicia para aplicar los cambios.')
      )
    }

    const salir = el('button', 'boton-memoria peligro', 'Cerrar Orbe por completo')
    salir.type = 'button'
    salir.addEventListener('click', () => void window.orbe.salirDeOrbe())
    const pie = el('div', 'ajuste-seccion')
    pie.append(salir)
    cuerpo.append(pie)

    this.raiz.replaceChildren(cabecera, cuerpo)
    cuerpo.scrollTop = desplazamiento
  }

  private async guardar(): Promise<void> {
    const b = this.borrador
    if (!b || this.guardando) return
    const peticion: PeticionConfig = {
      proveedor: b.proveedor,
      modelo: b.modelo,
      openaiUrl: b.openaiUrl,
      openaiKey: b.openaiKey,
      anthropicKey: b.anthropicKey,
      dictado: { ...b.dictado },
      voz: { ...b.voz },
      apariencia: b.apariencia,
      diseno: b.diseno,
      riveArchivo: b.riveArchivo,
      eventos: b.eventos,
      identidad: { ...b.identidad }
    }
    this.guardando = true
    this.mensaje = null
    this.pintar()
    try {
      const r = await window.orbe.configGuardar(peticion)
      if (r.ok) {
        this.mensaje = { texto: 'Guardado. Orbe se está reiniciando…', error: false }
      } else {
        this.mensaje = { texto: r.error, error: true }
        this.guardando = false
      }
    } catch {
      this.mensaje = { texto: 'No se pudo guardar la configuración.', error: true }
      this.guardando = false
    }
    this.pintar()
  }
}
