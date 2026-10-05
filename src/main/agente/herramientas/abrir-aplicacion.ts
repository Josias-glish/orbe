import { motivoNombreProhibido, type CatalogoAplicaciones, type EntradaApp } from '../aplicaciones'
import { AccionProhibida, definirHerramienta, type Herramienta, type Validacion } from '../tipos'
import { crearEsquema, crearValidador, type Campos } from '../validacion'

const campos = {
  nombre: { tipo: 'texto', descripcion: 'El nombre de la aplicación tal como aparece en el menú Inicio, p. ej. «Calculadora» o «Spotify».', max: 80 }
} as const satisfies Campos

interface EntradaAbrirAplicacion {
  nombre: string
}

/** Cómo se lanza una aplicación. Sin argumentos: ninguna orden de abrir lleva nada que haya escrito el modelo. */
export interface LanzadorApps {
  /** Abre un .lnk o un .exe como si el usuario hiciera doble clic (en Electron, `shell.openPath`). */
  abrirRuta(ruta: string): Promise<void>
  /** Abre una app de Microsoft Store por su identificador (en Windows, `explorer shell:AppsFolder\<id>`). */
  abrirTienda(appId: string): Promise<void>
}

const validarCampos = crearValidador<EntradaAbrirAplicacion>(campos)

/** Un nombre, no una ruta ni una orden: nada de barras, dos puntos ni símbolos de consola. */
function validar(entrada: unknown): Validacion<EntradaAbrirAplicacion> {
  const r = validarCampos(entrada)
  if (!r.ok) return r
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(r.valor.nombre)) {
    return { ok: false, error: 'Dame solo el nombre de la aplicación, como aparece en el menú Inicio; no una ruta ni una orden.' }
  }
  return { ok: true, valor: { nombre: r.valor.nombre.trim() } }
}

async function lanzar(entrada: EntradaApp, lanzador: LanzadorApps): Promise<void> {
  if (entrada.origen === 'tienda' && entrada.appId) return lanzador.abrirTienda(entrada.appId)
  if (entrada.ruta) return lanzador.abrirRuta(entrada.ruta)
  throw new Error('La aplicación no tiene con qué abrirse.')
}

/**
 * `abrir_aplicacion`: abre una aplicación instalada por su nombre, como el menú Inicio. El modelo solo elige un nombre;
 * la ruta con que se abre sale del catálogo (menú Inicio y `aplicaciones.json` del usuario). No hay argumentos, ni
 * consolas, ni configuración del sistema, ni scripts. Solo la abre: el agente no la controla ni ve su contenido.
 */
export function crearAbrirAplicacion(catalogo: CatalogoAplicaciones, lanzador: LanzadorApps): Herramienta {
  return definirHerramienta<EntradaAbrirAplicacion>({
    nombre: 'abrir_aplicacion',
    descripcion:
      'Abre una aplicación instalada en el equipo por su nombre, como en el menú Inicio (por ejemplo «Calculadora», «Spotify», «Bloc de notas»). ' +
      'Solo la abre: no puedes controlarla ni ver su contenido, y no admite argumentos ni rutas. No abre consolas, la configuración del sistema ni scripts.',
    esquema: crearEsquema(campos),
    nivel: 'libre',
    validar,
    describir: (e) => `Abriendo: ${e.nombre}`,
    async ejecutar(e) {
      // Primero lo que no se abre nunca, sin esperar a leer el menú Inicio.
      const prohibido = motivoNombreProhibido(e.nombre)
      if (prohibido) throw new AccionProhibida(prohibido)

      const r = await catalogo.resolver(e.nombre)
      switch (r.tipo) {
        case 'prohibida':
          throw new AccionProhibida(r.motivo)
        case 'varias':
          throw new Error(`Hay varias aplicaciones que encajan con «${e.nombre}»: ${r.candidatas.join(', ')}. Pregúntale al usuario cuál quiere abrir.`)
        case 'ninguna':
          throw new Error(
            `No encuentro ninguna aplicación llamada «${e.nombre}» en el menú Inicio.` +
              (r.sugerencias.length > 0 ? ` Parecidas: ${r.sugerencias.join(', ')}.` : '') +
              ' Si no está instalada, díselo al usuario.'
          )
        case 'una':
          await lanzar(r.entrada, lanzador)
          return { texto: `Pedí a Windows que abriera «${r.entrada.nombre}». No puedes ver ni controlar la aplicación.` }
      }
    }
  })
}
