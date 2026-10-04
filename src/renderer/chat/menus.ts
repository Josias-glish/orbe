/**
 * Los menús flotantes de la cabecera (fondo, voz) comparten sitio: al abrir uno se cierran los demás.
 * Cada menú se registra con su identificador y avisa cuando se abre.
 */
const EVENTO = 'orbe-menu-abierto'

export function registrarMenu(id: string, cerrar: () => void): { anunciarApertura(): void } {
  document.addEventListener(EVENTO, (e) => {
    if ((e as CustomEvent<string>).detail !== id) cerrar()
  })
  return { anunciarApertura: () => document.dispatchEvent(new CustomEvent(EVENTO, { detail: id })) }
}
