import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'

export interface AccionesBandeja {
  alternarVisibilidad(): void
  mostrarPanel(): void
  nuevaConversacion(): void
  leerPantalla(): void
  salir(): void
}

export interface EstadoBandeja {
  visible: boolean
  /** Solo se ofrece «Iniciar con Windows» en la app instalada: en desarrollo registraría electron.exe. */
  inicioDisponible: boolean
  iniciaConWindows: boolean
  alCambiarInicio(valor: boolean): void
}

/** El menú de la bandeja, como datos (así se puede probar sin Electron). */
export function plantillaBandeja(acciones: AccionesBandeja, estado: EstadoBandeja): MenuItemConstructorOptions[] {
  const plantilla: MenuItemConstructorOptions[] = [
    { label: estado.visible ? 'Ocultar Orbe' : 'Mostrar Orbe', click: acciones.alternarVisibilidad },
    { label: 'Abrir el chat', click: acciones.mostrarPanel },
    { label: 'Nueva conversación', click: acciones.nuevaConversacion },
    { label: 'Leer la pantalla', click: acciones.leerPantalla },
    { type: 'separator' }
  ]
  if (estado.inicioDisponible) {
    plantilla.push({
      label: 'Iniciar con Windows',
      type: 'checkbox',
      checked: estado.iniciaConWindows,
      click: (item) => estado.alCambiarInicio(item.checked)
    })
  }
  plantilla.push({ label: 'Salir', click: acciones.salir })
  return plantilla
}

/** Si Orbe arranca con Windows (siempre falso fuera de la app instalada). */
export function iniciaConWindows(): boolean {
  return app.isPackaged && app.getLoginItemSettings().openAtLogin
}

export function fijarInicioConWindows(valor: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: valor })
}

/** El icono junto al reloj: clic para mostrar u ocultar, clic derecho para el menú. */
export function crearBandeja(
  acciones: AccionesBandeja,
  estadoVisible: () => boolean,
  carpetaRecursos: string
): Tray | null {
  const imagen = nativeImage.createFromPath(join(carpetaRecursos, 'tray.png'))
  if (imagen.isEmpty()) {
    console.warn('[orbe] No se encontró el icono de la bandeja; Orbe seguirá sin él.')
    return null
  }
  const tray = new Tray(imagen)
  tray.setToolTip('Orbe')
  const construir = (): Menu =>
    Menu.buildFromTemplate(
      plantillaBandeja(acciones, {
        visible: estadoVisible(),
        inicioDisponible: app.isPackaged,
        iniciaConWindows: iniciaConWindows(),
        alCambiarInicio: fijarInicioConWindows
      })
    )
  // El menú se rehace al abrirlo para que «Ocultar/Mostrar» y la casilla estén al día.
  tray.on('click', acciones.alternarVisibilidad)
  tray.on('right-click', () => tray.popUpContextMenu(construir()))
  return tray
}
