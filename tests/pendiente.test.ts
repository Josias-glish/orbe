import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResultadoLectura } from '../src/main/pantalla/contexto'
import { CADUCIDAD_POR_DEFECTO_MS, ContextoPendiente } from '../src/main/pantalla/pendiente'

function lectura(): ResultadoLectura {
  return {
    contexto: {
      ventana: { aplicacion: 'Google Chrome', titulo: 'Receta', url: 'https://example.com/' },
      seleccion: 'texto seleccionado',
      seleccionRecortada: true,
      contenido: 'contenido de la ventana',
      contenidoRecortado: true
    },
    lectura: {
      partes: [
        { clave: 'ventana', etiqueta: 'Ventana', resumen: 'Google Chrome — Receta', vista: 'Aplicación: Google Chrome' },
        { clave: 'seleccion', etiqueta: 'Selección', resumen: '18 caracteres', vista: 'texto seleccionado', caracteres: 18, recortado: true },
        { clave: 'contenido', etiqueta: 'Contenido', resumen: '23 caracteres', vista: 'contenido de la ventana', caracteres: 23, recortado: true }
      ],
      avisos: ['un aviso'],
      sugerirCaptura: false
    }
  }
}

let caducadas: number
let pendiente: ContextoPendiente

beforeEach(() => {
  vi.useFakeTimers()
  caducadas = 0
  pendiente = new ContextoPendiente(() => caducadas++)
})

afterEach(() => {
  pendiente.descartar()
  vi.useRealTimers()
})

describe('ContextoPendiente', () => {
  it('empieza vacío', () => {
    expect(pendiente.hay()).toBe(false)
    expect(pendiente.lectura()).toBeNull()
    expect(pendiente.consumir()).toBeNull()
  })

  it('guarda una lectura y la devuelve sin exponer su estado interno', () => {
    const devuelta = pendiente.establecer(lectura())
    expect(pendiente.hay()).toBe(true)
    devuelta.partes.pop()
    devuelta.avisos.push('manipulado')
    expect(pendiente.lectura()!.partes).toHaveLength(3)
    expect(pendiente.lectura()!.avisos).toEqual(['un aviso'])
  })

  it('una lectura nueva sustituye a la anterior', () => {
    pendiente.establecer(lectura())
    const otra = lectura()
    otra.contexto = { ventana: { aplicacion: 'Edge', titulo: 'Otra' } }
    otra.lectura.partes = [otra.lectura.partes[0]]
    pendiente.establecer(otra)
    expect(pendiente.consumir()!.contexto.ventana?.aplicacion).toBe('Edge')
  })

  it('consumir entrega el contexto una sola vez y lo vacía', () => {
    pendiente.establecer(lectura())
    const c = pendiente.consumir()
    expect(c!.contexto.seleccion).toBe('texto seleccionado')
    expect(pendiente.hay()).toBe(false)
    expect(pendiente.consumir()).toBeNull()
  })

  it('restaurar devuelve un contexto consumido para poder reintentar', () => {
    pendiente.establecer(lectura())
    const c = pendiente.consumir()!
    const l = pendiente.restaurar(c)
    expect(l.partes.map((p) => p.clave)).toEqual(['ventana', 'seleccion', 'contenido'])
    expect(pendiente.consumir()!.contexto.contenido).toBe('contenido de la ventana')
  })
})

describe('ContextoPendiente.quitar', () => {
  it('quitar un trozo lo borra de lo que se enviará y de lo que se muestra', () => {
    pendiente.establecer(lectura())
    const l = pendiente.quitar('contenido')!
    expect(l.partes.map((p) => p.clave)).toEqual(['ventana', 'seleccion'])
    const c = pendiente.consumir()!.contexto
    expect(c.contenido).toBeUndefined()
    expect(c.contenidoRecortado).toBeUndefined()
    expect(c.seleccion).toBe('texto seleccionado')
  })

  it('quitar la selección borra también su marca de recorte', () => {
    pendiente.establecer(lectura())
    pendiente.quitar('seleccion')
    const c = pendiente.consumir()!.contexto
    expect(c.seleccion).toBeUndefined()
    expect(c.seleccionRecortada).toBeUndefined()
  })

  it('quitar la ventana deja el resto', () => {
    pendiente.establecer(lectura())
    pendiente.quitar('ventana')
    const c = pendiente.consumir()!.contexto
    expect(c.ventana).toBeUndefined()
    expect(c.contenido).toBeDefined()
  })

  it('al quitar el último trozo no queda nada pendiente', () => {
    const una = lectura()
    una.lectura.partes = [una.lectura.partes[0]]
    una.contexto = { ventana: una.contexto.ventana }
    pendiente.establecer(una)
    expect(pendiente.quitar('ventana')).toBeNull()
    expect(pendiente.hay()).toBe(false)
  })

  it('quitar algo que no está, o sin nada pendiente, no rompe', () => {
    expect(pendiente.quitar('contenido')).toBeNull()
    pendiente.establecer(lectura())
    expect(pendiente.quitar('imagen')!.partes).toHaveLength(3)
  })
})

describe('ContextoPendiente: caducidad', () => {
  it('caduca a los cinco minutos y avisa', () => {
    pendiente.establecer(lectura())
    vi.advanceTimersByTime(CADUCIDAD_POR_DEFECTO_MS - 1)
    expect(pendiente.hay()).toBe(true)
    expect(caducadas).toBe(0)
    vi.advanceTimersByTime(2)
    expect(pendiente.hay()).toBe(false)
    expect(caducadas).toBe(1)
    expect(pendiente.consumir()).toBeNull()
  })

  it('una lectura nueva reinicia el reloj', () => {
    pendiente.establecer(lectura())
    vi.advanceTimersByTime(CADUCIDAD_POR_DEFECTO_MS - 1000)
    pendiente.establecer(lectura())
    vi.advanceTimersByTime(CADUCIDAD_POR_DEFECTO_MS - 1000)
    expect(pendiente.hay()).toBe(true)
    vi.advanceTimersByTime(1500)
    expect(pendiente.hay()).toBe(false)
    expect(caducadas).toBe(1)
  })

  it('descartar o consumir cancelan la caducidad (no avisa de lo que ya no existe)', () => {
    pendiente.establecer(lectura())
    pendiente.descartar()
    vi.advanceTimersByTime(CADUCIDAD_POR_DEFECTO_MS * 2)
    expect(caducadas).toBe(0)

    pendiente.establecer(lectura())
    pendiente.consumir()
    vi.advanceTimersByTime(CADUCIDAD_POR_DEFECTO_MS * 2)
    expect(caducadas).toBe(0)
  })

  it('restaurar rearma el reloj', () => {
    pendiente.establecer(lectura())
    const c = pendiente.consumir()!
    vi.advanceTimersByTime(60_000)
    pendiente.restaurar(c)
    vi.advanceTimersByTime(CADUCIDAD_POR_DEFECTO_MS - 1000)
    expect(pendiente.hay()).toBe(true)
    vi.advanceTimersByTime(1500)
    expect(pendiente.hay()).toBe(false)
  })

  it('admite otra caducidad', () => {
    const corto = new ContextoPendiente(() => caducadas++, 1000)
    corto.establecer(lectura())
    vi.advanceTimersByTime(1001)
    expect(corto.hay()).toBe(false)
    expect(caducadas).toBe(1)
  })
})
