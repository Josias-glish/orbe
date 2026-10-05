import type { Config } from '../../entorno'
import { crearProveedorBusqueda } from '../busqueda'
import { RegistroHerramientas } from '../registro'
import type { Herramienta } from '../tipos'
import { crearBuscarWeb } from './buscar-web'

/**
 * Las herramientas del agente según la configuración: cada fase del modo agente añade las suyas aquí. Con la API de
 * Claude la búsqueda web es la nativa (no es una herramienta nuestra), así que `buscar_web` solo se ofrece a los
 * servicios compatibles con OpenAI y solo si hay un buscador bien configurado.
 */
export function crearRegistro(config: Config): RegistroHerramientas {
  const herramientas: Herramienta[] = []
  if (config.proveedor === 'openai' && config.busqueda.proveedor) {
    herramientas.push(
      crearBuscarWeb(crearProveedorBusqueda({ proveedor: config.busqueda.proveedor, clave: config.busqueda.clave, url: config.busqueda.url }))
    )
  }
  return new RegistroHerramientas(herramientas)
}
