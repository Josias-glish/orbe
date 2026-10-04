import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { ClienteHelper, ErrorHelper, type LanzadorHelper } from '../src/main/pantalla/helper-uia'

const aqui = dirname(fileURLToPath(import.meta.url))
const FALSO = join(aqui, 'falso-helper.mjs')

let hijos: ChildProcess[] = []
let clientes: ClienteHelper[] = []

function lanzadorFalso(modo = 'normal'): LanzadorHelper {
  return () => {
    const hijo = spawn(process.execPath, [FALSO, modo], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    hijos.push(hijo)
    return hijo
  }
}

function cliente(modo = 'normal', extra: Partial<ConstructorParameters<typeof ClienteHelper>[0]> = {}): ClienteHelper {
  const c = new ClienteHelper({ pidOrbe: 1234, cacheDir: 'cache', lanzador: lanzadorFalso(modo), ...extra })
  clientes.push(c)
  return c
}

async function errorDe(promesa: Promise<unknown>): Promise<ErrorHelper> {
  try {
    await promesa
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorHelper)
    return e as ErrorHelper
  }
  throw new Error('Se esperaba un error y no hubo ninguno')
}

const salido = (hijo: ChildProcess): Promise<void> =>
  new Promise((resolver) => (hijo.exitCode !== null || hijo.signalCode !== null ? resolver() : hijo.once('exit', () => resolver())))
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

afterEach(async () => {
  for (const c of clientes) c.cerrar()
  for (const h of hijos) {
    h.kill()
    await salido(h)
  }
  clientes = []
  hijos = []
})

describe('ClienteHelper', () => {
  it('lanza el helper con el pid de Orbe y la carpeta de caché, y espera a que esté listo', async () => {
    const recibido: Array<{ pidOrbe: number; cacheDir: string }> = []
    const c = cliente('normal', {
      lanzador: (args) => {
        recibido.push(args)
        return lanzadorFalso()(args)
      }
    })
    await c.asegurarListo()
    expect(recibido).toEqual([{ pidOrbe: 1234, cacheDir: 'cache' }])
  })

  it('envía la petición como JSON con id, operación y parámetros, y devuelve los datos', async () => {
    const c = cliente()
    const datos = await c.pedir<{ id: number; op: string; hwnd: number; max: number }>('eco', { hwnd: 77, max: 5000 })
    expect(datos).toMatchObject({ op: 'eco', hwnd: 77, max: 5000 })
    expect(typeof datos.id).toBe('number')
  })

  it('arranca una sola vez aunque lleguen varias peticiones a la vez', async () => {
    let lanzamientos = 0
    const c = cliente('normal', {
      lanzador: (args) => {
        lanzamientos++
        return lanzadorFalso()(args)
      }
    })
    await Promise.all([c.pedir('eco'), c.pedir('eco'), c.pedir('eco')])
    expect(lanzamientos).toBe(1)
  })

  it('reparte cada respuesta a quien la pidió aunque lleguen desordenadas', async () => {
    const c = cliente()
    const [lenta, rapida] = await Promise.all([
      c.pedir<{ nombre: string }>('eco', { nombre: 'lenta', retrasoMs: 200 }),
      c.pedir<{ nombre: string }>('eco', { nombre: 'rapida', retrasoMs: 5 })
    ])
    expect(lenta.nombre).toBe('lenta')
    expect(rapida.nombre).toBe('rapida')
  })

  it('un fallo de la operación se convierte en ErrorHelper con su mensaje', async () => {
    const e = await errorDe(cliente().pedir('falla'))
    expect(e.message).toBe('No se pudo leer esa ventana.')
  })

  it('si el helper no contesta a tiempo, falla; y una respuesta tardía no estropea la siguiente', async () => {
    const c = cliente()
    const e = await errorDe(c.pedir('silencio', {}, 250))
    expect(e.message).toMatch(/no respondió a «silencio»/)
    await expect(c.pedir('eco', { ok: 1 })).resolves.toMatchObject({ ok: 1 })
  })

  it('ignora las líneas que no son JSON (ruido de PowerShell)', async () => {
    const c = cliente('ruido')
    await expect(c.pedir('eco', { x: 1 })).resolves.toMatchObject({ x: 1 })
    await expect(c.pedir('eco', { x: 2 })).resolves.toMatchObject({ x: 2 })
  })
})

describe('ClienteHelper: caídas y relanzado', () => {
  it('si el helper muere a mitad de una petición, esa petición falla; la siguiente lo relanza', async () => {
    let lanzamientos = 0
    const c = cliente('normal', {
      lanzador: (args) => {
        lanzamientos++
        return lanzadorFalso()(args)
      }
    })
    await c.pedir('eco')
    const e = await errorDe(c.pedir('morir'))
    expect(e.message).toMatch(/se detuvo inesperadamente/)

    await expect(c.pedir('eco', { de: 'nuevo' })).resolves.toMatchObject({ de: 'nuevo' })
    expect(lanzamientos).toBe(2)
  })

  it('cerrar() mata el proceso y rechaza lo que estaba pendiente', async () => {
    const c = cliente()
    await c.asegurarListo()
    const pendiente = c.pedir('silencio', {}, 5000)
    await esperar(50)
    const hijo = hijos[0]
    c.cerrar()
    const e = await errorDe(pendiente)
    expect(e.message).toMatch(/se cerró/)
    await salido(hijo)
    expect(hijo.exitCode !== null || hijo.signalCode !== null).toBe(true)
  })

  it('cerrar() sin haber arrancado no hace nada', () => {
    expect(() => cliente().cerrar()).not.toThrow()
  })
})

describe('ClienteHelper: fallos al arrancar', () => {
  it('si el helper dice que no pudo prepararse, el error trae su explicación', async () => {
    const e = await errorDe(cliente('error-arranque').pedir('eco'))
    expect(e.message).toContain('no compila')
  })

  it('si el proceso se cierra antes de estar listo, el error incluye el código y lo que escribió', async () => {
    const e = await errorDe(cliente('cae-al-arrancar').pedir('eco'))
    expect(e.message).toMatch(/se cerró al arrancar \(código 1\)/)
    expect(e.message).toContain('Fallo grave al compilar')
  })

  it('si nunca dice «listo», se rinde a los pocos segundos y mata el proceso', async () => {
    const c = cliente('no-arranca', { arranqueMaxMs: 300 })
    const e = await errorDe(c.pedir('eco'))
    expect(e.message).toMatch(/no arrancó en/)
    await salido(hijos[0])
    expect(hijos[0].exitCode !== null || hijos[0].signalCode !== null).toBe(true)
  })

  it('tras un arranque fallido, la siguiente petición lo intenta de nuevo', async () => {
    let lanzamientos = 0
    const c = cliente('error-arranque', {
      lanzador: (args) => {
        lanzamientos++
        // El primer intento falla; el segundo arranca bien.
        return lanzadorFalso(lanzamientos === 1 ? 'error-arranque' : 'normal')(args)
      }
    })
    await errorDe(c.pedir('eco'))
    await esperar(300) // el proceso fallido termina de salir y el cliente se limpia
    await expect(c.pedir('eco', { reintento: true })).resolves.toMatchObject({ reintento: true })
    expect(lanzamientos).toBe(2)
  })

  it('sin lanzador ni carpeta del helper, lo dice claramente', async () => {
    const c = new ClienteHelper({ pidOrbe: 1, cacheDir: 'x' })
    clientes.push(c)
    const e = await errorDe(c.pedir('eco'))
    expect(e.message).toMatch(/No se indicó dónde está el lector de pantalla/)
  })

  it('un lanzador que lanza una excepción da un error legible', async () => {
    const c = new ClienteHelper({
      pidOrbe: 1,
      cacheDir: 'x',
      lanzador: () => {
        throw new Error('ENOENT powershell.exe')
      }
    })
    clientes.push(c)
    const e = await errorDe(c.pedir('eco'))
    expect(e.message).toContain('No se pudo iniciar el lector de pantalla')
    expect(e.message).toContain('ENOENT')
  })

  it('precalentar() no lanza ni deja un rechazo sin atender si el arranque falla', async () => {
    const c = cliente('error-arranque')
    expect(() => c.precalentar()).not.toThrow()
    await esperar(300)
    // Si hubiera una promesa rechazada sin atender, vitest habría marcado la prueba como fallida.
  })
})
