import { join } from 'node:path'
import type { InfoChat } from '../../shared/tipos'
import type { RegistroHerramientas } from '../agente/registro'
import { agenteActivo, type OpcionesAgente } from '../agente/sesion'
import { nombreLegibleModelo, type Config } from '../entorno'
import type { ProveedorChat } from './proveedor'
import { ProveedorApi } from './proveedor-api'
import { ProveedorCli } from './proveedor-cli'
import { ProveedorOpenai } from './proveedor-openai'

/**
 * Las opciones del modo agente, o `undefined` si no corresponde: está apagado (ORBE_AGENTE=0), no hay
 * herramientas que ofrecer o el proveedor es el CLI (que va con `--tools ""` y no admite las nuestras).
 */
export function opcionesAgente(config: Config, registro: RegistroHerramientas | undefined): OpcionesAgente | undefined {
  if (!registro || !config.agente.activo || config.proveedor === 'cli') return undefined
  const opciones: OpcionesAgente = { registro, maxPasos: config.agente.pasos, permitirLocal: config.agente.permitirLocal }
  return agenteActivo(opciones) ? opciones : undefined
}

/**
 * Crea el proveedor que indica la configuración. `datosApp` es la carpeta de datos del usuario, `memoria`
 * da el bloque de memoria del usuario para el prompt de cada conversación nueva y `registro` las herramientas
 * del agente (sin ellas el chat solo conversa).
 */
export function crearProveedor(
  config: Config,
  datosApp: string,
  memoria?: () => string | undefined,
  registro?: RegistroHerramientas
): ProveedorChat {
  const agente = opcionesAgente(config, registro)
  if (config.proveedor === 'api') {
    return new ProveedorApi({ apiKey: config.apiKey, modelo: config.modelo, esfuerzo: config.esfuerzo, memoria, agente })
  }
  if (config.proveedor === 'openai') {
    return new ProveedorOpenai({ url: config.openaiUrl, clave: config.openaiKey, modelo: config.modelo, memoria, agente })
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
export function infoChat(config: Config, registro?: RegistroHerramientas): InfoChat {
  return {
    proveedor: config.proveedor,
    modelo: config.modelo,
    modeloLegible: nombreLegibleModelo(config.modelo),
    agente: opcionesAgente(config, registro) !== undefined
  }
}
