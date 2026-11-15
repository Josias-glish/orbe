import { execFileSync } from 'node:child_process'

const MARCA = '__ORBE_PATH__'

/** Saca el PATH de lo que imprimió la shell (que puede traer avisos de su configuración alrededor). */
export function extraerPath(salida: string): string | null {
  const partes = salida.split(MARCA)
  const path = partes.length >= 3 ? partes[1].trim() : ''
  return path.includes('/') ? path : null
}

/**
 * Una app de macOS abierta desde el Finder hereda un PATH mínimo (/usr/bin:/bin:/usr/sbin:/sbin): no encuentra `claude`
 * ni el `node` que necesita su instalación por npm. Se toma el PATH de la shell de inicio de sesión del usuario, el mismo
 * que vería al abrir una terminal. Si falla, se queda el que había.
 */
export function completarPathMac(): void {
  if (process.platform !== 'darwin') return
  try {
    const shell = process.env['SHELL'] || '/bin/zsh'
    const salida = execFileSync(shell, ['-ilc', `printf '${MARCA}%s${MARCA}' "$PATH"`], { encoding: 'utf8', timeout: 4000 })
    const path = extraerPath(salida)
    if (path) process.env['PATH'] = path
  } catch {
    // Sin PATH de la shell: se busca el CLI en sus rutas habituales (ver buscarRutaCli).
  }
}
