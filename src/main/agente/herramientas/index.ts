import type { Config } from '../../entorno'
import { crearProveedorBusqueda } from '../busqueda'
import { RegistroHerramientas } from '../registro'
import type { DepsSistema } from '../sistema'
import type { Herramienta } from '../tipos'
import { crearAbrirAplicacion } from './abrir-aplicacion'
import { crearAbrirUrl } from './abrir-url'
import { crearBuscarWeb } from './buscar-web'

/**
 * Las herramientas del agente según la configuración: cada fase del modo agente añade las suyas aquí.
 * - `buscar_web`: solo con un servicio compatible con OpenAI y un buscador configurado (con la API de Claude la
 *   búsqueda web es la nativa, que no es una herramienta nuestra).
 * - `abrir_url` y `abrir_aplicacion`: con el sistema real (`deps`); sin él, p. ej. en las pruebas, no se ofrecen.
 */
export function crearRegistro(config: Config, deps?: Pick<DepsSistema, 'abrirUrl' | 'catalogo' | 'lanzador'>): RegistroHerramientas {
  const herramientas: Herramienta[] = []
  if (config.proveedor === 'openai' && config.busqueda.proveedor) {
    herramientas.push(
      crearBuscarWeb(crearProveedorBusqueda({ proveedor: config.busqueda.proveedor, clave: config.busqueda.clave, url: config.busqueda.url }))
    )
  }
  if (deps) herramientas.push(crearAbrirUrl(deps.abrirUrl), crearAbrirAplicacion(deps.catalogo, deps.lanzador))
  return new RegistroHerramientas(herramientas)
}
