import type { ProveedorBusquedaConfig } from '../entorno'
import { recortar } from './validacion'

/** Un resultado de un buscador: todo es texto de terceros, que llega al modelo como datos y nunca como instrucciones. */
export interface ResultadoBusqueda {
  titulo: string
  url: string
  extracto: string
}

export interface ProveedorBusqueda {
  readonly nombre: ProveedorBusquedaConfig
  buscar(consulta: string, max: number, senal: AbortSignal): Promise<ResultadoBusqueda[]>
}

export interface OpcionesBusqueda {
  proveedor: ProveedorBusquedaConfig
  /** Clave de Tavily (no se usa con SearXNG). */
  clave: string
  /** Dirección del SearXNG propio (no se usa con Tavily). */
  url: string
  /** Para pruebas. */
  fetch?: typeof fetch
  /** Tiempo máximo de cada búsqueda. */
  esperaMaxMs?: number
}

const URL_TAVILY = 'https://api.tavily.com/search'
const MAX_RESPUESTA = 1_000_000
const MAX_EXTRACTO = 500
const MAX_TITULO = 200

/** Un fallo del buscador con un mensaje que se le puede dar tal cual al usuario y al modelo (nunca lleva la clave). */
export class ErrorBusqueda extends Error {}

function esTextoUtil(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.trim() !== ''
}

/** Lee el cuerpo de una respuesta con un tope de tamaño: un servidor mal configurado no puede llenar la memoria. */
async function leerLimitado(respuesta: Response): Promise<string> {
  if (!respuesta.body) return ''
  const lector = respuesta.body.getReader()
  const decodificador = new TextDecoder()
  let texto = ''
  let total = 0
  for (;;) {
    const { done, value } = await lector.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPUESTA) {
      void lector.cancel()
      throw new ErrorBusqueda('El buscador devolvió una respuesta demasiado grande.')
    }
    texto += decodificador.decode(value, { stream: true })
  }
  return texto + decodificador.decode()
}

/** Pasa lo que devolvió el buscador a resultados limpios: solo enlaces web, con título y extracto recortados. */
function aResultados(lista: unknown, campoExtracto: string, max: number): ResultadoBusqueda[] {
  if (!Array.isArray(lista)) throw new ErrorBusqueda('El buscador devolvió una respuesta que no entiendo.')
  const resultados: ResultadoBusqueda[] = []
  for (const r of lista) {
    if (resultados.length >= max) break
    if (typeof r !== 'object' || r === null) continue
    const bruto = r as Record<string, unknown>
    const url = bruto['url']
    if (!esTextoUtil(url) || !/^https?:\/\//i.test(url)) continue
    const titulo = esTextoUtil(bruto['title']) ? bruto['title'].replace(/\s+/g, ' ').trim() : url
    const extracto = esTextoUtil(bruto[campoExtracto]) ? bruto[campoExtracto].replace(/\s+/g, ' ').trim() : ''
    resultados.push({ titulo: recortar(titulo, MAX_TITULO), url, extracto: recortar(extracto, MAX_EXTRACTO) })
  }
  return resultados
}

/** Junta la señal de Detener con un tiempo máximo: lo que ocurra antes corta la petición. */
function conTiempo(senal: AbortSignal, ms: number): { senal: AbortSignal; limpiar: () => void; vencio: () => boolean } {
  const controlador = new AbortController()
  let vencido = false
  const alAbortar = (): void => controlador.abort()
  if (senal.aborted) controlador.abort()
  else senal.addEventListener('abort', alAbortar, { once: true })
  const reloj = setTimeout(() => {
    vencido = true
    controlador.abort()
  }, ms)
  return {
    senal: controlador.signal,
    limpiar: () => {
      clearTimeout(reloj)
      senal.removeEventListener('abort', alAbortar)
    },
    vencio: () => vencido
  }
}

/** Tavily: buscador pensado para agentes (1000 búsquedas gratis al mes, sin tarjeta). */
function crearTavily(o: OpcionesBusqueda): ProveedorBusqueda {
  return {
    nombre: 'tavily',
    async buscar(consulta, max, senal) {
      const peticion = conTiempo(senal, o.esperaMaxMs ?? 20_000)
      try {
        const respuesta = await (o.fetch ?? fetch)(URL_TAVILY, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${o.clave}` },
          body: JSON.stringify({ query: consulta, max_results: max, search_depth: 'basic', include_answer: false }),
          signal: peticion.senal
        })
        if (!respuesta.ok) {
          if (respuesta.status === 401) throw new ErrorBusqueda('Tavily ha rechazado la clave de búsqueda (ORBE_BUSQUEDA_KEY).')
          if (respuesta.status === 429 || respuesta.status === 432 || respuesta.status === 433) {
            throw new ErrorBusqueda('Tavily ha puesto un límite: se acabó el cupo de búsquedas o hay demasiadas seguidas.')
          }
          throw new ErrorBusqueda(`Tavily no pudo buscar (HTTP ${respuesta.status}).`)
        }
        return aResultados(extraerLista(await leerLimitado(respuesta), 'results'), 'content', max)
      } catch (e) {
        throw traducir(e, peticion.vencio(), 'Tavily')
      } finally {
        peticion.limpiar()
      }
    }
  }
}

/** SearXNG: metabuscador libre que cada quien puede alojar; hay que activar el formato JSON en su configuración. */
function crearSearxng(o: OpcionesBusqueda): ProveedorBusqueda {
  const base = o.url.replace(/\/+$/, '')
  return {
    nombre: 'searxng',
    async buscar(consulta, max, senal) {
      const peticion = conTiempo(senal, o.esperaMaxMs ?? 20_000)
      try {
        const direccion = `${base}/search?${new URLSearchParams({ q: consulta, format: 'json', safesearch: '1' }).toString()}`
        const respuesta = await (o.fetch ?? fetch)(direccion, { headers: { accept: 'application/json' }, signal: peticion.senal })
        if (!respuesta.ok) {
          if (respuesta.status === 403) {
            throw new ErrorBusqueda('Tu SearXNG no tiene activado el formato JSON (añade «json» a search.formats en su settings.yml).')
          }
          throw new ErrorBusqueda(`SearXNG no pudo buscar (HTTP ${respuesta.status}).`)
        }
        return aResultados(extraerLista(await leerLimitado(respuesta), 'results'), 'content', max)
      } catch (e) {
        throw traducir(e, peticion.vencio(), 'SearXNG')
      } finally {
        peticion.limpiar()
      }
    }
  }
}

function extraerLista(cuerpo: string, campo: string): unknown {
  try {
    return (JSON.parse(cuerpo) as Record<string, unknown>)[campo]
  } catch {
    throw new ErrorBusqueda('El buscador devolvió una respuesta que no es JSON.')
  }
}

/** Los fallos de red se cuentan sin detalles técnicos que no ayudan; los nuestros ya vienen en español. */
function traducir(e: unknown, vencio: boolean, nombre: string): unknown {
  if (e instanceof ErrorBusqueda) return e
  if (vencio) return new ErrorBusqueda(`${nombre} tardó demasiado en responder.`)
  if (e instanceof Error && e.name === 'AbortError') return e
  return new ErrorBusqueda(`No pude conectar con ${nombre}.`)
}

export function crearProveedorBusqueda(o: OpcionesBusqueda): ProveedorBusqueda {
  return o.proveedor === 'tavily' ? crearTavily(o) : crearSearxng(o)
}
