import type { ClaveNueva, ConfigVista, PeticionConfig } from '../../shared/tipos'
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
}

/**
 * La pantalla de configuración: qué IA responde (el CLI de Claude, la API de Anthropic u otro servicio compatible con
 * OpenAI), de dónde sale el dictado y qué voz neuronal lee las respuestas. Las claves solo viajan de aquí al proceso
 * principal, que las guarda en el .env: nunca vuelven a la pantalla.
 */
export class VistaAjustes {
  private vista: ConfigVista | null = null
  private borrador: Borrador | null = null
  private mensaje: { texto: string; error: boolean } | null = null
  private guardando = false

  constructor(
    private readonly raiz: HTMLElement,
    private readonly alVolver: () => void
  ) {}

  get visible(): boolean {
    return !this.raiz.hidden
  }

  async abrir(): Promise<void> {
    this.raiz.hidden = false
    this.mensaje = null
    this.guardando = false
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
        voz: { url: v.voz.url, modelo: v.voz.modelo, voz: v.voz.voz, clave: undefined }
      }
      this.pintar()
    } catch {
      this.raiz.replaceChildren(el('p', 'memoria-nota', 'No he podido leer la configuración.'))
    }
  }

  cerrar(): void {
    this.raiz.hidden = true
    this.borrador = null
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
    volver.addEventListener('click', () => this.alVolver())
    cabecera.append(volver, el('span', 'memoria-titulo', 'Configuración'))

    const cuerpo = el('div', 'memoria-cuerpo ajustes-cuerpo')

    // --- Quién responde ---
    const proveedor = this.selector(
      [
        { id: 'cli', nombre: 'Claude con el CLI de Claude (tu sesión, sin clave)' },
        { id: 'api', nombre: 'Claude con la API de Anthropic (con clave)' },
        { id: 'openai', nombre: 'Otra IA compatible con OpenAI (Groq, NVIDIA, Ollama…)' }
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

    cuerpo.append(
      this.seccion('Quién responde', ...responde),
      this.seccion('Dictado (micrófono)', ...secDictado),
      this.seccion('Voz neuronal (leer en voz alta)', ...secVoz)
    )

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
    cuerpo.append(acciones)
    if (this.mensaje) cuerpo.append(el('p', this.mensaje.error ? 'memoria-error' : 'memoria-nota', this.mensaje.texto))
    cuerpo.append(
      el('p', 'memoria-nota', 'Las claves se guardan en el archivo .env de tu equipo y nunca vuelven a mostrarse aquí. Al guardar, Orbe se reinicia para aplicar los cambios.')
    )

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
      voz: { ...b.voz }
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
