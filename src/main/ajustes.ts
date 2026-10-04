import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface Ajustes {
  /** Esquina superior izquierda de la ventana colapsada, en píxeles de pantalla. */
  posicion?: { x: number; y: number }
}

const ruta = (): string => join(app.getPath('userData'), 'ajustes.json')

export function leerAjustes(): Ajustes {
  try {
    return JSON.parse(readFileSync(ruta(), 'utf8')) as Ajustes
  } catch {
    return {}
  }
}

export function guardarAjustes(ajustes: Ajustes): void {
  try {
    mkdirSync(dirname(ruta()), { recursive: true })
    writeFileSync(ruta(), JSON.stringify(ajustes, null, 2))
  } catch (error) {
    console.error('No se pudieron guardar los ajustes:', error)
  }
}
