import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { CANALES, type EstadoVentana } from '../shared/tipos'
import { guardarAjustes, leerAjustes } from './ajustes'
import {
  TAM_COLAPSADO,
  dentroDe,
  disposicionExpandida,
  posicionPorDefecto,
  rectColapsadoDesde,
  type DisposicionExpandida,
  type Rect
} from './geometria'

/** Controla la ventana flotante: creación, colapsar/expandir, arrastre y posición recordada. */
export class VentanaOrbe {
  readonly ventana: BrowserWindow
  private expandido = false
  private ancla: DisposicionExpandida['ancla'] = { horizontal: 'derecha', vertical: 'abajo' }
  /** Rectángulo de la ventana colapsada; es el que se recuerda entre sesiones. */
  private colapsado: Rect
  private arrastre: { dx: number; dy: number } | null = null

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

    this.ventana.once('ready-to-show', () => this.ventana.showInactive())
    this.ventana.on('show', () => this.avisarVisibilidad(true))
    this.ventana.on('hide', () => this.avisarVisibilidad(false))
    this.ventana.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.ventana.webContents.on('will-navigate', (evento) => evento.preventDefault())

    this.registrarIpc()

    if (this.urlRenderer) void this.ventana.loadURL(this.urlRenderer)
    else void this.ventana.loadFile(this.rutaHtml)
  }

  private areaDe(punto: { x: number; y: number }): Rect {
    return screen.getDisplayNearestPoint(punto).workArea
  }

  /** Posición guardada si sigue cayendo en alguna pantalla; si no, la esquina inferior derecha. */
  private posicionInicial(): Rect {
    const guardada = leerAjustes().posicion
    const primaria = screen.getPrimaryDisplay().workArea
    if (guardada) {
      const rect = { ...TAM_COLAPSADO, ...guardada }
      const centro = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      const visible = screen.getAllDisplays().some((d) => {
        const a = d.workArea
        return centro.x >= a.x && centro.x <= a.x + a.width && centro.y >= a.y && centro.y <= a.y + a.height
      })
      if (visible) return dentroDe(rect, this.areaDe(centro))
    }
    return posicionPorDefecto(primaria)
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

  establecerExpandido(valor: boolean): void {
    if (valor === this.expandido) return
    if (valor) {
      const disposicion = disposicionExpandida(this.colapsado, this.areaDe(this.colapsado))
      this.ancla = disposicion.ancla
      this.ventana.setBounds(disposicion.bounds)
      this.expandido = true
    } else {
      this.expandido = false
      this.ventana.setBounds(this.colapsado)
    }
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

  private registrarIpc(): void {
    const propia = (evento: Electron.IpcMainEvent): boolean => evento.sender === this.ventana.webContents

    ipcMain.on(CANALES.alternar, (evento) => {
      if (propia(evento)) this.alternar()
    })

    ipcMain.on(CANALES.arrastreInicio, (evento, x: number, y: number) => {
      if (!propia(evento)) return
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
