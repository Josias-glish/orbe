import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'

export interface AccionesBandeja {
  alternarVisibilidad(): void
  mostrarPanel(): void
  nuevaConversacion(): void
  leerPantalla(): void
  /** Corta todo lo que esté haciendo el agente: la respuesta del chat y las tareas de fondo. */
  detenerAccion(): void
  /** Cierra Orbe y ejecuta el instalador ya descargado. */
  instalarActualizacion?(): void
  salir(): void
}

export interface EstadoBandeja {
  visible: boolean
  /** Hay una respuesta o una tarea en curso: solo entonces se ofrece «Detener». */
  hayTurno?: boolean
  /** Solo se ofrece «Abrir al iniciar sesión» en la app instalada: en desarrollo registraría electron.exe. */
  inicioDisponible: boolean
  iniciaConWindows: boolean
  alCambiarInicio(valor: boolean): void
  /** Versión nueva ya descargada y comprobada. */
  actualizacionLista?: string | null
}

/** El menú de la bandeja, como datos (así se puede probar sin Electron). */
export function plantillaBandeja(acciones: AccionesBandeja, estado: EstadoBandeja): MenuItemConstructorOptions[] {
  const plantilla: MenuItemConstructorOptions[] = [
    ...(estado.hayTurno ? [{ label: 'Detener todo', click: acciones.detenerAccion } as MenuItemConstructorOptions, { type: 'separator' } as MenuItemConstructorOptions] : []),
    { label: estado.visible ? 'Ocultar Orbe' : 'Mostrar Orbe', click: acciones.alternarVisibilidad },
    { label: 'Abrir el chat', click: acciones.mostrarPanel },
    { label: 'Nueva conversación', click: acciones.nuevaConversacion },
    { label: 'Leer la pantalla', click: acciones.leerPantalla },
    { type: 'separator' }
  ]
  if (estado.inicioDisponible) {
    plantilla.push({
      label: 'Abrir al iniciar sesión',
      type: 'checkbox',
      checked: estado.iniciaConWindows,
      click: (item) => estado.alCambiarInicio(item.checked)
    })
  }
  if (estado.actualizacionLista && acciones.instalarActualizacion) {
    plantilla.push({ label: `Instalar actualización ${estado.actualizacionLista}`, click: acciones.instalarActualizacion })
  }
  plantilla.push({ label: 'Salir', click: acciones.salir })
  return plantilla
}

/** Si Orbe arranca con Windows (siempre falso fuera de la app instalada). */
export function iniciaConWindows(): boolean {
  return app.isPackaged && app.getLoginItemSettings(opcionesInicio()).openAtLogin
}

export function fijarInicioConWindows(valor: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: valor, ...opcionesInicio() })
}

/**
 * La versión portable se descomprime en una carpeta temporal en cada arranque: lo que tiene que arrancar con Windows
 * es el `.exe` portable original (electron-builder lo deja en PORTABLE_EXECUTABLE_FILE), no el temporal.
 */
function opcionesInicio(): { path?: string } {
  const portable = process.env['PORTABLE_EXECUTABLE_FILE']
  return portable ? { path: portable } : {}
}

/** El icono junto al reloj: clic para mostrar u ocultar, clic derecho para el menú. */
export function crearBandeja(
  acciones: AccionesBandeja,
  estadoVisible: () => boolean,
  carpetaRecursos: string,
  hayTurno: () => boolean = () => false,
  actualizacionLista: () => string | null = () => null
): Tray | null {
  // En macOS, el icono de la barra de menús mide 18 puntos (tray-mac@2x.png se elige solo en pantallas Retina).
  const imagen = nativeImage.createFromPath(join(carpetaRecursos, process.platform === 'darwin' ? 'tray-mac.png' : 'tray.png'))
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
        hayTurno: hayTurno(),
        inicioDisponible: app.isPackaged,
        iniciaConWindows: iniciaConWindows(),
        alCambiarInicio: fijarInicioConWindows,
        actualizacionLista: actualizacionLista()
      })
    )
  // El menú se rehace al abrirlo para que «Ocultar/Mostrar» y la casilla estén al día.
  tray.on('click', acciones.alternarVisibilidad)
  tray.on('right-click', () => tray.popUpContextMenu(construir()))
  return tray
}
