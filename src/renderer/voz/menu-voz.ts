import type { InfoVoz } from '../../shared/tipos'
import { registrarMenu } from '../chat/menus'
import { LectorVoz, TONO_MAX, TONO_MIN, VELOCIDAD_MAX, VELOCIDAD_MIN, type MotorVoz } from './lector'

function el<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(etiqueta)
  if (clase) e.className = clase
  if (texto !== undefined) e.textContent = texto
  return e
}

/** El menú de voz de la cabecera: leer en voz alta, estilo Jarvis, motor, voz, velocidad, tono y estado del dictado. */
export class MenuVoz {
  private info: InfoVoz | null = null
  private botonParar: HTMLButtonElement | null = null
  private readonly menus: { anunciarApertura(): void }

  constructor(
    private readonly boton: HTMLButtonElement,
    private readonly menu: HTMLElement,
    private readonly lector: LectorVoz
  ) {
    this.menus = registrarMenu('voz', () => this.cerrar())
    boton.addEventListener('click', (e) => {
      e.stopPropagation()
      if (this.menu.hidden) void this.abrir()
      else this.cerrar()
    })
    document.addEventListener('click', (e) => {
      // La ruta del evento se calcula al lanzarlo: sigue valiendo aunque el botón pulsado ya se haya repintado y no esté en el DOM.
      if (!this.menu.hidden && !e.composedPath().includes(this.menu)) this.cerrar()
    })
    // El botón refleja si se lee en voz alta y si se está hablando.
    lector.alCambiar(() => {
      this.pintarBoton()
      if (this.botonParar) this.botonParar.disabled = !lector.hablando
    })
    this.pintarBoton()
  }

  cerrarSiAbierto(): boolean {
    if (this.menu.hidden) return false
    this.cerrar()
    return true
  }

  private async abrir(): Promise<void> {
    this.menus.anunciarApertura()
    try {
      this.info = await window.orbe.vozInfo()
    } catch {
      this.info = null
    }
    this.menu.hidden = false
    this.boton.setAttribute('aria-expanded', 'true')
    this.pintar()
  }

  private cerrar(): void {
    this.menu.hidden = true
    this.boton.setAttribute('aria-expanded', 'false')
  }

  private pintarBoton(): void {
    const prefs = this.lector.obtenerPrefs()
    this.boton.classList.toggle('activo', prefs.activa)
    this.boton.classList.toggle('hablando', this.lector.hablando)
    this.boton.title = prefs.activa ? 'Voz: leyendo las respuestas en voz alta' : 'Voz y dictado'
  }

  private pintar(): void {
    const prefs = this.lector.obtenerPrefs()
    const neuronal = this.info?.neuronal === true
    const usaNeuronal = prefs.motor === 'neuronal' && neuronal

    const jarvis = el('button', 'boton-memoria primario', 'Estilo Jarvis')
    jarvis.type = 'button'
    jarvis.title = neuronal
      ? 'Voz neuronal grave, serena y elegante, a un ritmo pausado'
      : 'Voz masculina de Windows, grave y pausada (con una clave de voz neuronal suena mucho más natural)'
    jarvis.disabled = !this.lector.disponible
    jarvis.addEventListener('click', () => {
      this.lector.aplicarEstiloJarvis(neuronal)
      this.pintarBoton()
      this.pintar()
      this.lector.probar()
    })

    const leer = el('label', 'memoria-opcion')
    const casillaLeer = el('input')
    casillaLeer.type = 'checkbox'
    casillaLeer.checked = prefs.activa
    casillaLeer.disabled = !this.lector.disponible
    casillaLeer.addEventListener('change', () => {
      this.lector.fijarPrefs({ activa: casillaLeer.checked })
      this.pintarBoton()
    })
    leer.append(casillaLeer, el('span', undefined, this.lector.disponible ? 'Leer las respuestas en voz alta' : 'Este equipo no tiene voces instaladas'))

    const hijos: HTMLElement[] = [jarvis, leer]

    if (neuronal) {
      const filaMotor = el('label', 'fondo-visibilidad')
      const motor = el('select', 'voz-selector')
      motor.setAttribute('aria-label', 'Motor de voz')
      for (const [valor, texto] of [
        ['windows', 'Voces de Windows (gratis, sin conexión)'],
        ['neuronal', `Voz neuronal «${this.info?.vozNeuronal ?? ''}» (más natural, con tu clave)`]
      ] as const) {
        const opcion = el('option', undefined, texto)
        opcion.value = valor
        opcion.selected = prefs.motor === valor
        motor.append(opcion)
      }
      motor.addEventListener('change', () => {
        this.lector.fijarPrefs({ motor: motor.value as MotorVoz })
        this.pintar()
      })
      filaMotor.append(el('span', undefined, 'Motor de voz'), motor)
      hijos.push(filaMotor)
      if (usaNeuronal) hijos.push(el('p', 'memoria-nota', 'Con la voz neuronal, el texto de las respuestas viaja al servicio de voz. Los ajustes de voz de Windows de abajo no se aplican.'))
    }

    const voces = this.lector.voces()
    const filaVoz = el('label', 'fondo-visibilidad')
    const selector = el('select', 'voz-selector')
    selector.setAttribute('aria-label', 'Voz de Windows')
    const elegida = voces.find((v) => v.voiceURI === prefs.voz) ?? voces.find((v) => v.lang.toLowerCase().startsWith('es'))
    for (const v of voces) {
      const opcion = el('option', undefined, `${v.name} (${v.lang})`)
      opcion.value = v.voiceURI
      opcion.selected = v === elegida
      selector.append(opcion)
    }
    selector.disabled = voces.length === 0 || usaNeuronal
    selector.addEventListener('change', () => this.lector.fijarPrefs({ voz: selector.value }))
    filaVoz.append(el('span', undefined, 'Voz de Windows'), selector)

    const filaVelocidad = el('label', 'fondo-visibilidad')
    const etiquetaVelocidad = el('span', undefined, `Velocidad: ${prefs.velocidad.toFixed(1)}×`)
    const rango = el('input')
    rango.type = 'range'
    rango.min = String(VELOCIDAD_MIN * 10)
    rango.max = String(VELOCIDAD_MAX * 10)
    rango.step = '1'
    rango.value = String(Math.round(prefs.velocidad * 10))
    rango.setAttribute('aria-label', 'Velocidad de la voz')
    rango.addEventListener('input', () => (etiquetaVelocidad.textContent = `Velocidad: ${(Number(rango.value) / 10).toFixed(1)}×`))
    rango.addEventListener('change', () => this.lector.fijarPrefs({ velocidad: Number(rango.value) / 10 }))
    filaVelocidad.append(etiquetaVelocidad, rango)

    const filaTono = el('label', 'fondo-visibilidad')
    const etiquetaTono = el('span', undefined, `Tono: ${prefs.tono.toFixed(1)} (más bajo = más grave)`)
    const tono = el('input')
    tono.type = 'range'
    tono.min = String(TONO_MIN * 10)
    tono.max = String(TONO_MAX * 10)
    tono.step = '1'
    tono.value = String(Math.round(prefs.tono * 10))
    tono.disabled = usaNeuronal
    tono.setAttribute('aria-label', 'Tono de la voz de Windows')
    tono.addEventListener('input', () => (etiquetaTono.textContent = `Tono: ${(Number(tono.value) / 10).toFixed(1)} (más bajo = más grave)`))
    tono.addEventListener('change', () => this.lector.fijarPrefs({ tono: Number(tono.value) / 10 }))
    filaTono.append(etiquetaTono, tono)

    const acciones = el('div', 'recuerdo-acciones')
    const probar = el('button', 'boton-memoria', 'Probar la voz')
    probar.type = 'button'
    probar.disabled = !this.lector.disponible
    probar.addEventListener('click', () => this.lector.probar())
    const parar = el('button', 'boton-memoria', 'Parar')
    parar.type = 'button'
    parar.disabled = !this.lector.hablando
    parar.addEventListener('click', () => this.lector.parar())
    this.botonParar = parar
    acciones.append(probar, parar)

    const auto = el('label', 'memoria-opcion')
    const casillaAuto = el('input')
    casillaAuto.type = 'checkbox'
    casillaAuto.checked = prefs.autoenviar
    casillaAuto.addEventListener('change', () => this.lector.fijarPrefs({ autoenviar: casillaAuto.checked }))
    auto.append(casillaAuto, el('span', undefined, 'Enviar el mensaje al terminar de dictar'))

    const dictado = el(
      'p',
      'memoria-nota',
      this.info?.dictado
        ? `Dictado listo (${this.info.modelo}, idioma ${this.info.idioma}). Pulsa el micrófono, habla y vuelve a pulsarlo.`
        : 'Dictado sin configurar: añade ORBE_STT_KEY (o ORBE_OPENAI_KEY) en el archivo .env para poder dictar.'
    )
    const notaNeuronal = neuronal
      ? null
      : el('p', 'memoria-nota', 'Para una voz neuronal más natural, añade ORBE_TTS_KEY (o ORBE_OPENAI_KEY) en el archivo .env.')

    hijos.push(filaVoz, filaVelocidad, filaTono, acciones, auto, dictado)
    if (notaNeuronal) hijos.push(notaNeuronal)
    this.menu.replaceChildren(...hijos)
  }
}
