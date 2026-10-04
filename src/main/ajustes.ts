import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface Ajustes {
  /** Esquina superior izquierda de la ventana colapsada, en píxeles de pantalla. */
  posicion?: { x: number; y: number }
  /** Tamaño del panel de chat que eligió el usuario. */
  panel?: { ancho: number; alto: number }
  /** El panel abierto se queda por encima de las demás ventanas (por defecto sí). */
  fijada?: boolean
}

const ruta = (): string => join(app.getPath('userData'), 'ajustes.json')

export function leerAjustes(): Ajustes {
  try {
    return JSON.parse(readFileSync(ruta(), 'utf8')) as Ajustes
  } catch {
    return {}
  }
}

/** Guarda solo lo que se pasa y conserva el resto (la posición y el tamaño se guardan por separado). */
export function guardarAjustes(cambios: Ajustes): void {
  try {
    mkdirSync(dirname(ruta()), { recursive: true })
    writeFileSync(ruta(), JSON.stringify({ ...leerAjustes(), ...cambios }, null, 2))
  } catch (error) {
    console.error('No se pudieron guardar los ajustes:', error)
  }
}
