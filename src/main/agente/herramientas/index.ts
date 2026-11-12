import type { Config } from '../../entorno'
import { crearProveedorBusqueda } from '../busqueda'
import { RegistroHerramientas } from '../registro'
import type { DepsSistema } from '../sistema'
import type { Herramienta } from '../tipos'
import { crearAbrirAplicacion } from './abrir-aplicacion'
import { crearAbrirUrl } from './abrir-url'
import { crearBuscarWeb } from './buscar-web'
import { crearProponerPlan } from './plan'

/**
 * Las herramientas del agente según la configuración: cada fase del modo agente añade las suyas aquí.
 * - `buscar_web`: solo con un servicio compatible con OpenAI y un buscador configurado (con la API de Claude la
 *   búsqueda web es la nativa, que no es una herramienta nuestra).
 * - `abrir_url` y `abrir_aplicacion`: con el sistema real (`deps`); sin él, p. ej. en las pruebas, no se ofrecen.
 * - `conectores`: las de los servicios conectados (Gmail…), que se crean en el arranque con el cofre.
 */
export function crearRegistro(config: Config, deps?: Pick<DepsSistema, 'abrirUrl' | 'catalogo' | 'lanzador'>,
  conectores: readonly Herramienta[] = []
): RegistroHerramientas {
  const herramientas: Herramienta[] = []
  if (config.proveedor === 'openai' && config.busqueda.proveedor) {
    herramientas.push(
      crearBuscarWeb(crearProveedorBusqueda({ proveedor: config.busqueda.proveedor, clave: config.busqueda.clave, url: config.busqueda.url }))
    )
  }
  if (deps) herramientas.push(crearAbrirUrl(deps.abrirUrl), crearAbrirAplicacion(deps.catalogo, deps.lanzador))
  herramientas.push(...conectores)
  // El plan solo tiene sentido si hay algo con lo que actuar.
  if (herramientas.length > 0) herramientas.unshift(crearProponerPlan())
  return new RegistroHerramientas(herramientas)
}
