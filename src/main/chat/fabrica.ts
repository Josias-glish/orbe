import { join } from 'node:path'
import type { InfoChat } from '../../shared/tipos'
import { nombreLegibleModelo, type Config } from '../entorno'
import type { ProveedorChat } from './proveedor'
import { ProveedorApi } from './proveedor-api'
import { ProveedorCli } from './proveedor-cli'

/**
 * Crea el proveedor que indica la configuración. `datosApp` es la carpeta de datos del usuario y `memoria`
 * da el bloque de memoria del usuario para el prompt de cada conversación nueva.
 */
export function crearProveedor(config: Config, datosApp: string, memoria?: () => string | undefined): ProveedorChat {
  if (config.proveedor === 'api') {
    return new ProveedorApi({ apiKey: config.apiKey, modelo: config.modelo, esfuerzo: config.esfuerzo, memoria })
  }
  return new ProveedorCli({
    modelo: config.modelo,
    esfuerzo: config.esfuerzo,
    rutaCli: config.rutaCli || undefined,
    // Carpeta vacía: así el CLI no encuentra ningún CLAUDE.md ni proyecto que cargar.
    directorioTrabajo: join(datosApp, 'cli-vacio'),
    memoria
  })
}

/** Lo único de la configuración que ve la interfaz: nunca incluye claves ni rutas. */
export function infoChat(config: Config): InfoChat {
  return {
    proveedor: config.proveedor,
    modelo: config.modelo,
    modeloLegible: nombreLegibleModelo(config.modelo)
  }
}
