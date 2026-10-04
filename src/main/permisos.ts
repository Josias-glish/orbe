import type { WebContents } from 'electron'

/**
 * Qué permisos de Chromium se conceden a la ventana de Orbe: el micrófono (solo audio, para el dictado, y solo
 * cuando el usuario pulsa grabar) y copiar al portapapeles. Todo lo demás se deniega.
 */
export function permisoPermitido(permiso: string, tiposDeMedio: readonly string[] | undefined): boolean {
  if (permiso === 'clipboard-sanitized-write') return true
  if (permiso === 'media') return Array.isArray(tiposDeMedio) && tiposDeMedio.length > 0 && tiposDeMedio.every((t) => t === 'audio')
  return false
}

export function restringirPermisos(contenido: WebContents): void {
  const sesion = contenido.session
  sesion.setPermissionRequestHandler((origen, permiso, devolver, detalles) => {
    const medios = (detalles as { mediaTypes?: string[] }).mediaTypes
    devolver(origen === contenido && permisoPermitido(permiso, medios))
  })
  sesion.setPermissionCheckHandler((origen, permiso, _url, detalles) => {
    const tipo = (detalles as { mediaType?: string }).mediaType
    return origen === contenido && permisoPermitido(permiso, tipo ? [tipo] : permiso === 'media' ? [] : undefined)
  })
}
