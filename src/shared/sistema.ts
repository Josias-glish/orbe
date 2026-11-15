/**
 * Lo que se le enseña al usuario y cambia según el sistema: su nombre y cómo se escriben los atajos. El proceso
 * principal usa `process.platform`; la interfaz, `window.orbe.plataforma` (lo pone el preload).
 */
export interface TextosSistema {
  nombre: 'Windows' | 'macOS'
  /** Atajo para abrir o cerrar el panel (CommandOrControl+Shift+Space). */
  atajoPanel: string
  /** Atajo para leer la pantalla (CommandOrControl+Shift+Alt+Space). */
  atajoLeer: string
  /** Cómo copiar un trozo de pantalla al portapapeles. */
  recorte: string
}

export function textosSistema(plataforma: string): TextosSistema {
  return plataforma === 'darwin'
    ? { nombre: 'macOS', atajoPanel: '⌘⇧Espacio', atajoLeer: '⌘⇧⌥Espacio', recorte: '⌃⇧⌘4' }
    : { nombre: 'Windows', atajoPanel: 'Ctrl+Mayús+Espacio', atajoLeer: 'Ctrl+Mayús+Alt+Espacio', recorte: 'Win+Mayús+S' }
}
