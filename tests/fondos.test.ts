import type { BrowserWindow } from 'electron'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolverConfig } from '../src/main/entorno'
import {
  ServicioFondos,
  VISIBILIDAD_MAX,
  VISIBILIDAD_MIN,
  VISIBILIDAD_POR_DEFECTO,
  limitarVisibilidad,
  type ProcesarImagen
} from '../src/main/fondos'
import { CANALES, type EstadoFondo } from '../src/shared/tipos'

type Manejador = (evento: unknown, ...args: unknown[]) => unknown
const electron = vi.hoisted(() => ({ manejadores: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (canal: string, fn: (...args: unknown[]) => unknown) => electron.manejadores.set(canal, fn), on: () => undefined },
  BrowserWindow: class {}
}))
const { registrarFondos } = await import('../src/main/fondos-ipc')

const JPEG = (nombre: string): Uint8Array => new TextEncoder().encode(`jpeg-de-${nombre}`)

function montar(archivos: string[] = ['a.png', 'b.jpg', 'c.jpeg'], extra: { procesar?: ProcesarImagen; azar?: () => number } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'orbe-fondos-'))
  const carpeta = join(base, 'imagenes')
  mkdirSync(carpeta)
  for (const a of archivos) writeFileSync(join(carpeta, a), `contenido de ${a}`)
  const procesadas: string[] = []
  const procesar: ProcesarImagen =
    extra.procesar ??
    (async (ruta) => {
      procesadas.push(ruta)
      return JPEG(ruta.split(/[\\/]/).pop()!)
    })
  const opciones = { carpeta, archivoEstado: join(base, 'fondo.json'), carpetaCache: join(base, 'cache'), procesar, azar: extra.azar }
  return { base, carpeta, procesadas, opciones, servicio: new ServicioFondos(opciones) }
}

const dataUrl = (nombre: string): string => `data:image/jpeg;base64,${Buffer.from(JPEG(nombre)).toString('base64')}`

describe('ServicioFondos: la carpeta', () => {
  it('sin carpeta configurada no hay fondos y no se ofrece el menú', async () => {
    const base = mkdtempSync(join(tmpdir(), 'orbe-fondos-'))
    const s = new ServicioFondos({ carpeta: null, archivoEstado: join(base, 'f.json'), carpetaCache: join(base, 'c'), procesar: async () => null })
    expect(s.listar()).toEqual([])
    expect(await s.estado()).toMatchObject({ disponible: false, activo: false, nombre: null, total: 0, imagen: null })
    expect(await s.siguiente()).toMatchObject({ disponible: false })
  })

  it('una carpeta que no existe o está vacía tampoco ofrece nada', async () => {
    const t = montar([])
    expect(await t.servicio.estado()).toMatchObject({ disponible: false, total: 0 })
    const inexistente = new ServicioFondos({ ...t.opciones, carpeta: join(t.base, 'no-existe') })
    expect(inexistente.listar()).toEqual([])
  })

  it('solo cuenta PNG y JPEG, sin importar mayúsculas, y los ordena', () => {
    const t = montar(['b.PNG', 'a.JPG', 'c.jpeg', 'notas.txt', 'd.gif', 'e.webp', 'f.bmp'])
    expect(t.servicio.listar()).toEqual(['a.JPG', 'b.PNG', 'c.jpeg'])
  })
})

describe('ServicioFondos: elegir el fondo', () => {
  it('la primera vez elige uno al azar y lo recuerda', async () => {
    const t = montar(['a.png', 'b.png', 'c.png'], { azar: () => 0.5 })
    const e = await t.servicio.estado()
    expect(e).toMatchObject({ disponible: true, activo: true, nombre: 'b.png', total: 3, visibilidad: VISIBILIDAD_POR_DEFECTO })
    expect(e.imagen).toBe(dataUrl('b.png'))
    expect(JSON.parse(readFileSync(t.opciones.archivoEstado, 'utf8'))).toMatchObject({ archivo: 'b.png', activo: true })
    // En otro arranque sigue siendo el mismo, aunque el azar diga otra cosa.
    const otro = new ServicioFondos({ ...t.opciones, azar: () => 0 })
    expect((await otro.estado()).nombre).toBe('b.png')
  })

  it('«otro fondo» cambia a una imagen distinta de la actual, y la deja guardada', async () => {
    const t = montar(['a.png', 'b.png', 'c.png'], { azar: () => 0 })
    await t.servicio.estado() // elige a.png
    for (let i = 0; i < 6; i++) {
      const antes = (await t.servicio.estado()).nombre
      const despues = await t.servicio.siguiente()
      expect(despues.nombre).not.toBe(antes)
      expect(despues.imagen).not.toBeNull()
    }
    const guardado = JSON.parse(readFileSync(t.opciones.archivoEstado, 'utf8')) as { archivo: string }
    expect(guardado.archivo).toBe((await t.servicio.estado()).nombre)
  })

  it('con una sola imagen, «otro fondo» se queda con ella', async () => {
    const t = montar(['unica.png'])
    expect((await t.servicio.siguiente()).nombre).toBe('unica.png')
  })

  it('«otro fondo» también reactiva el fondo si estaba apagado', async () => {
    const t = montar()
    await t.servicio.ajustar({ activo: false })
    const e = await t.servicio.siguiente()
    expect(e.activo).toBe(true)
    expect(e.imagen).not.toBeNull()
  })

  it('si la imagen guardada ya no está, elige otra', async () => {
    const t = montar(['a.png', 'b.png'], { azar: () => 0 })
    await t.servicio.estado()
    writeFileSync(t.opciones.archivoEstado, JSON.stringify({ activo: true, archivo: 'borrada.png', visibilidad: 0.5 }))
    const e = await t.servicio.estado()
    expect(['a.png', 'b.png']).toContain(e.nombre)
    expect(e.visibilidad).toBe(0.5)
  })

  it('si una imagen no se puede abrir (estropeada), prueba con otras y no se atasca', async () => {
    const t = montar(['mala.png', 'buena.png'], {
      azar: () => 0,
      procesar: async (ruta) => (ruta.endsWith('mala.png') ? null : JPEG('buena.png'))
    })
    const e = await t.servicio.estado()
    expect(e.nombre).toBe('buena.png')
    expect(e.imagen).toBe(dataUrl('buena.png'))
  })

  it('si ninguna se puede abrir, sigue disponible pero sin imagen', async () => {
    const t = montar(['mala.png', 'peor.png'], { procesar: async () => null })
    expect(await t.servicio.estado()).toMatchObject({ disponible: true, total: 2, imagen: null })
  })

  it('un procesador que lanza una excepción cuenta como imagen estropeada', async () => {
    const t = montar(['a.png', 'b.png'], {
      azar: () => 0,
      procesar: async (ruta) => {
        if (ruta.endsWith('a.png')) throw new Error('formato raro')
        return JPEG('b.png')
      }
    })
    expect((await t.servicio.estado()).nombre).toBe('b.png')
  })
})

describe('ServicioFondos: la copia reducida', () => {
  it('reduce una vez y guarda la copia: las siguientes lecturas no vuelven a abrir el original', async () => {
    const t = montar(['a.png'])
    await t.servicio.estado()
    await t.servicio.estado()
    await new ServicioFondos(t.opciones).estado() // otro arranque
    expect(t.procesadas).toHaveLength(1)
    expect(readdirSync(t.opciones.carpetaCache).filter((f) => f.endsWith('.jpg'))).toHaveLength(1)
    expect(readdirSync(t.opciones.carpetaCache).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('si el original cambia, se vuelve a reducir', async () => {
    const t = montar(['a.png'])
    await t.servicio.estado()
    writeFileSync(join(t.carpeta, 'a.png'), 'contenido distinto y más largo que el anterior')
    await t.servicio.estado()
    expect(t.procesadas).toHaveLength(2)
  })

  it('no toca los originales', async () => {
    const t = montar(['a.png'])
    await t.servicio.estado()
    expect(readFileSync(join(t.carpeta, 'a.png'), 'utf8')).toBe('contenido de a.png')
    expect(readdirSync(t.carpeta)).toEqual(['a.png'])
  })
})

describe('ServicioFondos: ajustes', () => {
  it('apagar el fondo no manda imagen y se recuerda; encenderlo la devuelve', async () => {
    const t = montar()
    await t.servicio.estado()
    const apagado = await t.servicio.ajustar({ activo: false })
    expect(apagado).toMatchObject({ activo: false, imagen: null, disponible: true })
    expect(await new ServicioFondos(t.opciones).estado()).toMatchObject({ activo: false, imagen: null })
    const encendido = await t.servicio.ajustar({ activo: true })
    expect(encendido).toMatchObject({ activo: true })
    expect(encendido.imagen).not.toBeNull()
  })

  it('mover la visibilidad se guarda y no vuelve a mandar la imagen', async () => {
    const t = montar()
    await t.servicio.estado()
    const e = await t.servicio.ajustar({ visibilidad: 0.7 })
    expect(e).toMatchObject({ visibilidad: 0.7, imagen: null, activo: true })
    expect((await new ServicioFondos(t.opciones).estado()).visibilidad).toBe(0.7)
  })

  it('la visibilidad se mantiene entre sus límites y redondeada', () => {
    expect(limitarVisibilidad(0)).toBe(VISIBILIDAD_MIN)
    expect(limitarVisibilidad(5)).toBe(VISIBILIDAD_MAX)
    expect(limitarVisibilidad(0.456)).toBe(0.46)
    expect(limitarVisibilidad(Number.NaN)).toBe(VISIBILIDAD_POR_DEFECTO)
  })

  it('un archivo de estado roto se trata como el primero', async () => {
    const t = montar()
    writeFileSync(t.opciones.archivoEstado, '{ roto')
    expect(await t.servicio.estado()).toMatchObject({ activo: true, visibilidad: VISIBILIDAD_POR_DEFECTO })
  })
})

describe('configuración: ORBE_FONDOS', () => {
  it('por defecto no hay carpeta; se lee del .env', () => {
    expect(resolverConfig({}, {}).fondosCarpeta).toBe('')
    expect(resolverConfig({ ORBE_FONDOS: 'C:\\Users\\yo\\Documents\\Solo Leveling' }, {}).fondosCarpeta).toBe('C:\\Users\\yo\\Documents\\Solo Leveling')
  })
})

describe('IPC de fondos', () => {
  function conectar() {
    electron.manejadores.clear()
    const t = montar()
    const webContents = {}
    registrarFondos({ webContents } as unknown as BrowserWindow, t.servicio)
    const invocar = async <T = unknown>(canal: string, propio: boolean, ...args: unknown[]): Promise<T> =>
      (await (electron.manejadores.get(canal) as Manejador)({ sender: propio ? webContents : {} }, ...args)) as T
    return { ...t, invocar }
  }

  it('solo atiende a la ventana de Orbe', async () => {
    const t = conectar()
    for (const [canal, ...args] of [[CANALES.fondoEstado], [CANALES.fondoSiguiente], [CANALES.fondoAjustar, { activo: false }]] as const) {
      await expect(t.invocar(canal, false, ...args)).rejects.toThrow(/no autorizado/i)
    }
    expect(await t.servicio.estado()).toMatchObject({ activo: true })
  })

  it('estado y siguiente devuelven el fondo', async () => {
    const t = conectar()
    expect(await t.invocar<EstadoFondo>(CANALES.fondoEstado, true)).toMatchObject({ disponible: true, total: 3 })
    expect((await t.invocar<EstadoFondo>(CANALES.fondoSiguiente, true)).imagen).not.toBeNull()
  })

  it('ajustar solo acepta los campos conocidos con el tipo correcto', async () => {
    const t = conectar()
    await t.invocar(CANALES.fondoEstado, true)
    const e = await t.invocar<EstadoFondo>(CANALES.fondoAjustar, true, { activo: 'no', visibilidad: 'mucha', archivo: '../../etc/passwd', malo: 1 })
    expect(e).toMatchObject({ activo: true, visibilidad: VISIBILIDAD_POR_DEFECTO })
    expect(JSON.parse(readFileSync(t.opciones.archivoEstado, 'utf8')).archivo).not.toContain('passwd')
    expect(await t.invocar<EstadoFondo>(CANALES.fondoAjustar, true, { visibilidad: Number.POSITIVE_INFINITY })).toMatchObject({ visibilidad: VISIBILIDAD_POR_DEFECTO })
    expect(await t.invocar<EstadoFondo>(CANALES.fondoAjustar, true, null)).toMatchObject({ disponible: true })
    expect(await t.invocar<EstadoFondo>(CANALES.fondoAjustar, true, { visibilidad: 0.8, activo: false })).toMatchObject({ visibilidad: 0.8, activo: false })
  })
})
