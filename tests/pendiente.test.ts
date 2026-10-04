import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapturaHecha } from '../src/main/pantalla/captura'
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

describe('ContextoPendiente con captura de pantalla', () => {
  const captura = (extra: { avisos?: string[]; base64?: string } = {}): CapturaHecha => ({
    imagen: { tipoMime: 'image/jpeg', base64: extra.base64 ?? 'AAAA', ancho: 1500, alto: 844 },
    parte: { clave: 'imagen', etiqueta: 'Captura', resumen: '1500×844 · 200 KB', vista: 'Esta captura viajará con tu próximo mensaje si lo envías.', miniatura: 'data:image/jpeg;base64,BBBB' },
    avisos: extra.avisos ?? []
  })

  it('sin nada leído antes, crea un contexto solo con la imagen', () => {
    const l = pendiente.agregarImagen(captura())
    expect(l.partes.map((p) => p.clave)).toEqual(['imagen'])
    expect(l.partes[0].miniatura).toBe('data:image/jpeg;base64,BBBB')
    expect(pendiente.hay()).toBe(true)
    const consumido = pendiente.consumir()!
    expect(consumido.contexto).toEqual({ imagen: { tipoMime: 'image/jpeg', base64: 'AAAA', ancho: 1500, alto: 844 } })
  })

  it('con texto ya leído, la imagen se suma al final y deja de sugerirse otra captura', () => {
    const poca = lectura()
    poca.lectura.sugerirCaptura = true
    pendiente.establecer(poca)
    const l = pendiente.agregarImagen(captura())
    expect(l.partes.map((p) => p.clave)).toEqual(['ventana', 'seleccion', 'contenido', 'imagen'])
    expect(l.sugerirCaptura).toBe(false)
    expect(l.avisos).toEqual(['un aviso'])
    const c = pendiente.consumir()!.contexto
    expect(c.imagen?.base64).toBe('AAAA')
    expect(c.contenido).toBe('contenido de la ventana')
  })

  it('una captura nueva sustituye a la anterior', () => {
    pendiente.agregarImagen(captura({ base64: 'VIEJA' }))
    const l = pendiente.agregarImagen(captura({ base64: 'NUEVA' }))
    expect(l.partes.filter((p) => p.clave === 'imagen')).toHaveLength(1)
    expect(pendiente.consumir()!.contexto.imagen?.base64).toBe('NUEVA')
  })

  it('los avisos de la captura (salió negra) se van con ella si se quita', () => {
    pendiente.establecer(lectura())
    pendiente.agregarImagen(captura({ avisos: ['salió negra'] }))
    expect(pendiente.lectura()!.avisos).toEqual(['un aviso', 'salió negra'])
    const l = pendiente.quitar('imagen')!
    expect(l.avisos).toEqual(['un aviso'])
    expect(l.partes.map((p) => p.clave)).toEqual(['ventana', 'seleccion', 'contenido'])
    expect(pendiente.consumir()!.contexto.imagen).toBeUndefined()
  })

  it('quitar la única parte (la captura) descarta todo el contexto', () => {
    pendiente.agregarImagen(captura())
    expect(pendiente.quitar('imagen')).toBeNull()
    expect(pendiente.hay()).toBe(false)
  })

  it('al hacer una captura se reinicia la caducidad', () => {
    pendiente.establecer(lectura())
    vi.advanceTimersByTime(CADUCIDAD_POR_DEFECTO_MS - 1000)
    pendiente.agregarImagen(captura())
    vi.advanceTimersByTime(CADUCIDAD_POR_DEFECTO_MS - 1000)
    expect(pendiente.hay()).toBe(true)
    vi.advanceTimersByTime(1500)
    expect(pendiente.hay()).toBe(false)
    expect(caducadas).toBe(1)
  })

  it('lo que devuelve no deja tocar el estado interno', () => {
    const l = pendiente.agregarImagen(captura())
    l.partes[0].miniatura = 'manipulada'
    expect(pendiente.lectura()!.partes[0].miniatura).toBe('data:image/jpeg;base64,BBBB')
  })
})
