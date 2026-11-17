import { BrowserWindow, app, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { CANALES, type EstadoVentana } from '../shared/tipos'
import { guardarAjustes, leerAjustes } from './ajustes'
import {
  TAM_BOCADILLO,
  TAM_COLAPSADO,
  anclarEn,
  dentroDe,
  disposicionExpandida,
  panelDeVentana,
  posicionPorDefecto,
  rectColapsadoDesde,
  redimensionar,
  type ModoRedimension,
  type DisposicionExpandida,
  type Rect
} from './geometria'

/** Controla la ventana flotante: creación, colapsar/expandir, arrastre y posición recordada. */
export class VentanaOrbe {
  readonly ventana: BrowserWindow
  private expandido = false
  /** Plegado, pero con el bocadillo del Compañero a la vista (la ventana crece sin moverse el personaje). */
  private bocadillo = false
  private ancla: DisposicionExpandida['ancla'] = { horizontal: 'derecha', vertical: 'abajo' }
  /** Rectángulo de la ventana colapsada; es el que se recuerda entre sesiones. */
  private colapsado: Rect
  private arrastre: { dx: number; dy: number } | null = null
  /** Redimensión en curso: dónde empezó el puntero, cómo era la ventana y qué ejes se mueven. */
  private redimension: { x0: number; y0: number; inicial: Rect; modo: ModoRedimension } | null = null
  /**
   * El tamaño que le hemos dado a la ventana expandida. Con una escala de pantalla fraccionaria, Windows lo
   * devuelve redondeado (380 → 381) y, si se volviera a leer, cada redimensión desviaría un píxel más.
   */
  private tamanoFijado: { width: number; height: number } | null = null
  /** El panel abierto se queda por encima de las demás ventanas. El orbe colapsado siempre lo está, para no perderlo. */

  constructor(
    private readonly urlRenderer: string | null,
    private readonly rutaHtml: string
  ) {
    this.colapsado = this.posicionInicial()

    this.ventana = new BrowserWindow({
      ...this.colapsado,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      focusable: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: true
      }
    })

    // 'screen-saver' lo mantiene por encima de casi todo, incluidas ventanas a pantalla completa.
    this.ventana.setAlwaysOnTop(true, 'screen-saver')
    this.ventana.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // Windows a veces le quita el «siempre encima» a una ventana (al pasar por una app a pantalla completa, al
    // reiniciarse el Explorador o cuando otra ventana se pone también encima): al perder el foco se vuelve a pedir.
    this.ventana.on('blur', () => this.reafirmarEncima())
    this.ventana.on('show', () => this.reafirmarEncima())
    screen.on('display-metrics-changed', () => this.reafirmarEncima())

    this.ventana.once('ready-to-show', () => this.ventana.showInactive())
    this.ventana.on('show', () => this.avisarVisibilidad(true))
    this.ventana.on('hide', () => this.avisarVisibilidad(false))
    this.ventana.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.ventana.webContents.on('will-navigate', (evento) => evento.preventDefault())

    // Sin página, la ventana transparente sigue «visible» pero no se ve nada: si el dibujo se cae o la página no
    // carga (en desarrollo, el servidor de Vite caído), se vuelve a cargar sola hasta que funcione.
    const recargar = (ms: number): void => {
      setTimeout(() => {
        if (!this.ventana.isDestroyed()) this.cargar()
      }, ms)
    }
    this.ventana.webContents.on('render-process-gone', (_e, d) => {
      console.error('El dibujo de Orbe se cayó; se recarga:', d.reason)
      // La página nueva arranca pidiendo «transparente al ratón» con su propio reenvío de movimientos: si el estado se
      // quedara en el de la página caída, esa petición no haría nada y el orbe no volvería a responder al ratón.
      this.interactivo = true
      if (!this.ventana.isDestroyed()) this.ventana.setIgnoreMouseEvents(false)
      recargar(1000)
    })
    // Si se cae el proceso de la tarjeta gráfica, Chromium lo relanza, pero la ventana transparente puede quedarse sin
    // pintar: se recarga la página igual que cuando se cae el dibujo.
    app.on('child-process-gone', (_e, d) => {
      if (d.type !== 'GPU') return
      console.error('El proceso gráfico de Orbe se cayó; se recarga el dibujo:', d.reason)
      recargar(1500)
    })
    this.ventana.webContents.on('did-fail-load', (_e, codigo, descripcion, _url, principal) => {
      if (!principal || codigo === -3) return // -3: carga anulada por otra, no es un fallo
      console.error('La página de Orbe no cargó; se reintenta:', descripcion)
      recargar(3000)
    })

    this.registrarIpc()
    this.cargar()
  }

  private cargar(): void {
    if (this.urlRenderer) void this.ventana.loadURL(this.urlRenderer).catch(() => undefined)
    else void this.ventana.loadFile(this.rutaHtml).catch(() => undefined)
  }

  private areaDe(punto: { x: number; y: number }): Rect {
    return screen.getDisplayNearestPoint(punto).workArea
  }

  /** Posición guardada si sigue cayendo en alguna pantalla; si no, la esquina inferior derecha. */
  private posicionInicial(): Rect {
    const guardada = leerAjustes().posicion
    const primaria = screen.getPrimaryDisplay().workArea
    // Solo se fía de la esquina guardada (x, y); el tamaño siempre es el del orbe, aunque el archivo diga otra cosa.
    if (guardada && Number.isFinite(guardada.x) && Number.isFinite(guardada.y)) {
      const rect = { ...TAM_COLAPSADO, x: guardada.x, y: guardada.y }
      const centro = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      const visible = screen.getAllDisplays().some((d) => {
        const a = d.workArea
        return centro.x >= a.x && centro.x <= a.x + a.width && centro.y >= a.y && centro.y <= a.y + a.height
      })
      if (visible) return dentroDe(rect, this.areaDe(centro))
    }
    return posicionPorDefecto(primaria)
  }

  /** 'screen-saver' lo mantiene por encima de casi todo, plegado o con el panel abierto (decisión del usuario: siempre fijado). */
  private aplicarNivel(): void {
    if (!this.ventana.isDestroyed()) this.ventana.setAlwaysOnTop(true, 'screen-saver')
  }

  /** Vuelve a poner Orbe por encima, sin robar el foco. */
  private reafirmarEncima(): void {
    if (this.ventana.isDestroyed() || !this.ventana.isVisible()) return
    this.ventana.setAlwaysOnTop(true, 'screen-saver')
    this.ventana.moveTop()
  }

  private estado(): EstadoVentana {
    return { expandido: this.expandido, ancla: this.ancla }
  }

  private avisarVisibilidad(visible: boolean): void {
    if (!this.ventana.isDestroyed()) this.ventana.webContents.send(CANALES.visibilidad, visible)
  }

  private avisarEstado(): void {
    if (!this.ventana.isDestroyed()) this.ventana.webContents.send(CANALES.expandidoCambio, this.estado())
  }

  get estaExpandido(): boolean {
    return this.expandido
  }

  get estaVisible(): boolean {
    return this.ventana.isVisible()
  }

  alternar(): void {
    this.establecerExpandido(!this.expandido)
  }

  /** ¿Recibe el ratón la ventana? Si no, los clics pasan a las ventanas de debajo (se siguen notando los movimientos). */
  private interactivo = true

  /**
   * Hace la ventana «transparente al ratón» salvo donde la interfaz diga (el centro del personaje y el panel).
   * Solo en Windows y macOS: allí Electron sigue entregando los movimientos del ratón con `forward`, y así la
   * interfaz sabe cuándo volver a recibirlo. En Linux eso no existe y la ventana dejaría de responder: se queda igual.
   */
  fijarInteractivo(dentro: boolean): void {
    if (process.platform !== 'win32' && process.platform !== 'darwin') return
    if (dentro === this.interactivo || this.ventana.isDestroyed()) return
    this.interactivo = dentro
    if (dentro) this.ventana.setIgnoreMouseEvents(false)
    else this.ventana.setIgnoreMouseEvents(true, { forward: true })
  }

  /**
   * Agranda la ventana plegada para el bocadillo (o la devuelve a su tamaño). Nunca da el foco ni mueve el personaje.
   * Devuelve el ancla, para que el globo se ponga al otro lado; null si no puede (panel abierto u Orbe oculto).
   */
  mostrarBocadillo(valor: boolean): DisposicionExpandida['ancla'] | null {
    if (this.ventana.isDestroyed() || this.expandido) return null
    if (!valor) {
      if (this.bocadillo) this.ventana.setBounds(this.colapsado)
      this.bocadillo = false
      return this.ancla
    }
    if (!this.ventana.isVisible()) return null
    const d = anclarEn(this.colapsado, this.areaDe(this.colapsado), TAM_BOCADILLO)
    this.bocadillo = true
    this.ancla = d.ancla
    this.ventana.setBounds(d.bounds)
    return d.ancla
  }

  establecerExpandido(valor: boolean): void {
    if (valor === this.expandido) return
    this.bocadillo = false
    if (valor) {
      const disposicion = disposicionExpandida(this.colapsado, this.areaDe(this.colapsado), leerAjustes().panel)
      this.ancla = disposicion.ancla
      this.ventana.setBounds(disposicion.bounds)
      this.tamanoFijado = { width: disposicion.bounds.width, height: disposicion.bounds.height }
      this.expandido = true
      // Con el panel abierto se va a escribir: la ventana necesita el foco (también al abrir con el atajo).
      this.ventana.focus()
    } else {
      this.expandido = false
      this.tamanoFijado = null
      this.ventana.setBounds(this.colapsado)
    }
    this.aplicarNivel()
    this.avisarEstado()
  }

  mostrar(): void {
    if (!this.ventana.isVisible()) this.ventana.showInactive()
  }

  ocultar(): void {
    this.ventana.hide()
  }

  alternarVisibilidad(): void {
    if (this.ventana.isVisible()) this.ocultar()
    else this.mostrar()
  }

  /** Da el foco al panel para poder escribir; solo tiene sentido con el panel abierto. */
  enfocar(): void {
    this.ventana.show()
    this.ventana.focus()
  }

  /** Empieza a cambiar el tamaño del panel (solo con el panel abierto). Las coordenadas son de pantalla. */
  redimensionarInicio(x: number, y: number, modo: ModoRedimension): void {
    if (!this.expandido) return
    const b = this.ventana.getBounds()
    const f = this.tamanoFijado
    // Si lo que devuelve Windows es lo que fijamos con un píxel de redondeo, se parte del tamaño fijado (con la esquina del orbe donde está).
    const redondeo = f !== null && Math.abs(b.width - f.width) <= 2 && Math.abs(b.height - f.height) <= 2
    const inicial: Rect = redondeo
      ? {
          width: f.width,
          height: f.height,
          x: this.ancla.horizontal === 'derecha' ? b.x + b.width - f.width : b.x,
          y: this.ancla.vertical === 'abajo' ? b.y + b.height - f.height : b.y
        }
      : b
    this.redimension = { x0: x, y0: y, inicial, modo }
  }

  redimensionarMover(x: number, y: number): void {
    const r = this.redimension
    if (!r) return
    const centro = { x: r.inicial.x + r.inicial.width / 2, y: r.inicial.y + r.inicial.height / 2 }
    const nuevo = redimensionar(r.inicial, this.ancla, { dx: x - r.x0, dy: y - r.y0 }, r.modo, this.areaDe(centro))
    this.ventana.setBounds(nuevo)
    this.tamanoFijado = { width: nuevo.width, height: nuevo.height }
  }

  /** Termina la redimensión: recuerda el tamaño elegido para la próxima vez. */
  redimensionarFin(): void {
    if (!this.redimension) return
    this.redimension = null
    const actual = this.ventana.getBounds()
    this.colapsado = rectColapsadoDesde(actual, this.ancla)
    guardarAjustes({ panel: panelDeVentana(this.tamanoFijado ? { ...actual, ...this.tamanoFijado } : actual) })
  }

  private registrarIpc(): void {
    // Al cerrar puede quedar un mensaje en vuelo: con la ventana destruida, leer webContents lanza y tumba el proceso.
    const propia = (evento: Electron.IpcMainEvent): boolean =>
      !this.ventana.isDestroyed() && evento.sender === this.ventana.webContents

    ipcMain.on(CANALES.alternar, (evento) => {
      if (propia(evento)) this.alternar()
    })

    // Solo el centro del personaje (y el panel, si está abierto) recibe el ratón: en el resto de la ventana
    // transparente los clics pasan a lo que haya debajo. La interfaz avisa al entrar y salir de esas zonas.
    ipcMain.on(CANALES.ratonInteractivo, (evento, dentro: unknown) => {
      if (propia(evento) && typeof dentro === 'boolean') this.fijarInteractivo(dentro)
    })

    const MODOS: readonly string[] = ['x', 'y', 'xy']
    const numero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
    ipcMain.on(CANALES.redimensionarInicio, (evento, x: unknown, y: unknown, modo: unknown) => {
      if (propia(evento) && numero(x) && numero(y) && typeof modo === 'string' && MODOS.includes(modo)) {
        this.redimensionarInicio(x, y, modo as ModoRedimension)
      }
    })
    ipcMain.on(CANALES.redimensionarMover, (evento, x: unknown, y: unknown) => {
      if (propia(evento) && numero(x) && numero(y)) this.redimensionarMover(x, y)
    })
    ipcMain.on(CANALES.redimensionarFin, (evento) => {
      if (propia(evento)) this.redimensionarFin()
    })

    ipcMain.on(CANALES.arrastreInicio, (evento, x: number, y: number) => {
      if (!propia(evento)) return
      // Arrastrar con el bocadillo a la vista: primero vuelve a ser solo el personaje.
      if (this.bocadillo) this.mostrarBocadillo(false)
      const [wx, wy] = this.ventana.getPosition()
      this.arrastre = { dx: x - wx, dy: y - wy }
    })

    ipcMain.on(CANALES.arrastreMover, (evento, x: number, y: number) => {
      if (!propia(evento) || !this.arrastre) return
      // setBounds con el tamaño fijo evita la deriva de tamaño de setPosition con escalado fraccionario.
      const actual = this.ventana.getBounds()
      const destino = { ...actual, x: Math.round(x - this.arrastre.dx), y: Math.round(y - this.arrastre.dy) }
      this.ventana.setBounds(destino)
    })

    ipcMain.on(CANALES.arrastreFin, (evento) => {
      if (!propia(evento) || !this.arrastre) return
      this.arrastre = null
      const actual = this.ventana.getBounds()
      const area = this.areaDe({ x: actual.x + actual.width / 2, y: actual.y + actual.height / 2 })
      const ajustado = dentroDe(actual, area)
      if (ajustado.x !== actual.x || ajustado.y !== actual.y) this.ventana.setBounds(ajustado)
      this.colapsado = this.expandido ? rectColapsadoDesde(ajustado, this.ancla) : ajustado
      guardarAjustes({ posicion: { x: this.colapsado.x, y: this.colapsado.y } })
    })
  }
}
