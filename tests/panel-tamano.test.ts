import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALTO_EXTRA_ORBE,
  TAM_COLAPSADO,
  TAM_PANEL_MAX,
  TAM_PANEL_MIN,
  disposicionExpandida,
  limitarPanel,
  panelDeVentana,
  posicionPorDefecto,
  rectColapsadoDesde,
  redimensionar,
  tamVentanaExpandida,
  type Rect
} from '../src/main/geometria'

const datos = vi.hoisted(() => ({ carpeta: '' }))
vi.mock('electron', () => ({ app: { getPath: () => datos.carpeta } }))
const { guardarAjustes, leerAjustes } = await import('../src/main/ajustes')

const area: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
const abajoDerecha = { horizontal: 'derecha', vertical: 'abajo' } as const
const arribaIzquierda = { horizontal: 'izquierda', vertical: 'arriba' } as const
const colapsado = posicionPorDefecto(area)
const ventana = disposicionExpandida(colapsado, area).bounds

describe('tamaño del panel', () => {
  it('la ventana expandida es el panel más la parte del orbe', () => {
    expect(tamVentanaExpandida({ ancho: 380, alto: 520 })).toEqual({ width: 380, height: 624 })
    expect(tamVentanaExpandida({ ancho: 500, alto: 700 })).toEqual({ width: 500, height: 804 })
    expect(panelDeVentana({ x: 0, y: 0, width: 500, height: 804 })).toEqual({ ancho: 500, alto: 700 })
  })

  it('limitarPanel respeta el mínimo, el máximo y el área de trabajo', () => {
    expect(limitarPanel({ ancho: 100, alto: 100 }, area)).toEqual(TAM_PANEL_MIN)
    expect(limitarPanel({ ancho: 5000, alto: 5000 }, area)).toEqual({ ancho: TAM_PANEL_MAX.ancho, alto: area.height - ALTO_EXTRA_ORBE })
    const pequena: Rect = { x: 0, y: 0, width: 500, height: 600 }
    expect(limitarPanel({ ancho: 800, alto: 900 }, pequena)).toEqual({ ancho: 500, alto: 600 - ALTO_EXTRA_ORBE })
  })

  it('disposicionExpandida usa el panel que se le da y, por defecto, el de siempre', () => {
    expect(disposicionExpandida(colapsado, area).bounds).toMatchObject({ width: 380, height: 624 })
    const grande = disposicionExpandida(colapsado, area, { ancho: 520, alto: 700 })
    expect(grande.bounds).toMatchObject({ width: 520, height: 804 })
    expect(grande.bounds.x + grande.bounds.width).toBe(colapsado.x + colapsado.width)
    expect(grande.bounds.y + grande.bounds.height).toBe(colapsado.y + colapsado.height)
  })

  it('un tamaño guardado que ya no cabe (pantalla más pequeña) se recorta', () => {
    const pequena: Rect = { x: 0, y: 0, width: 700, height: 600 }
    const { bounds } = disposicionExpandida({ ...TAM_COLAPSADO, x: 560, y: 460 }, pequena, { ancho: 800, alto: 1000 })
    expect(bounds.width).toBeLessThanOrEqual(700)
    expect(bounds.height).toBeLessThanOrEqual(600)
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
  })
})

describe('redimensionar', () => {
  it('anclado abajo a la derecha, arrastrar hacia arriba y a la izquierda agranda sin mover el orbe', () => {
    const r = redimensionar(ventana, abajoDerecha, { dx: -120, dy: -200 }, 'xy', area)
    expect(r.width).toBe(ventana.width + 120)
    expect(r.height).toBe(ventana.height + 200)
    expect(r.x + r.width).toBe(ventana.x + ventana.width)
    expect(r.y + r.height).toBe(ventana.y + ventana.height)
  })

  it('arrastrar al otro lado la encoge, hasta el mínimo', () => {
    const r = redimensionar(ventana, abajoDerecha, { dx: 30, dy: 100 }, 'xy', area)
    expect(r.width).toBe(ventana.width - 30)
    expect(r.height).toBe(ventana.height - 100)
    const minimo = redimensionar(ventana, abajoDerecha, { dx: 9999, dy: 9999 }, 'xy', area)
    expect(minimo.width).toBe(TAM_PANEL_MIN.ancho)
    expect(minimo.height).toBe(TAM_PANEL_MIN.alto + ALTO_EXTRA_ORBE)
    expect(minimo.x + minimo.width).toBe(ventana.x + ventana.width)
  })

  it('el modo «x» solo cambia el ancho y el «y» solo el alto', () => {
    expect(redimensionar(ventana, abajoDerecha, { dx: -50, dy: -50 }, 'x', area)).toMatchObject({ width: ventana.width + 50, height: ventana.height })
    expect(redimensionar(ventana, abajoDerecha, { dx: -50, dy: -50 }, 'y', area)).toMatchObject({ width: ventana.width, height: ventana.height + 50 })
  })

  it('anclado arriba a la izquierda crece hacia abajo y a la derecha, con la esquina fija', () => {
    const inicial = disposicionExpandida({ ...TAM_COLAPSADO, x: 20, y: 20 }, area).bounds
    expect(redimensionar(inicial, arribaIzquierda, { dx: 100, dy: 150 }, 'xy', area)).toMatchObject({
      x: 20,
      y: 20,
      width: inicial.width + 100,
      height: inicial.height + 150
    })
    expect(redimensionar(inicial, arribaIzquierda, { dx: -30, dy: -60 }, 'xy', area)).toMatchObject({ x: 20, y: 20, width: inicial.width - 30 })
  })

  it('nunca pasa del máximo ni se sale del área de trabajo', () => {
    const enorme = redimensionar(ventana, abajoDerecha, { dx: -5000, dy: -5000 }, 'xy', area)
    expect(enorme.width).toBe(TAM_PANEL_MAX.ancho)
    expect(enorme.x).toBeGreaterThanOrEqual(area.x)
    expect(enorme.y).toBeGreaterThanOrEqual(area.y)

    const pequena: Rect = { x: 0, y: 0, width: 600, height: 700 }
    const v = disposicionExpandida({ ...TAM_COLAPSADO, x: 480, y: 580 }, pequena).bounds
    const r = redimensionar(v, abajoDerecha, { dx: -5000, dy: -5000 }, 'xy', pequena)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.width).toBeLessThanOrEqual(600)
    expect(r.height).toBeLessThanOrEqual(700)
  })

  it('al terminar, el orbe colapsado queda donde estaba', () => {
    const r = redimensionar(ventana, abajoDerecha, { dx: -90, dy: -120 }, 'xy', area)
    expect(rectColapsadoDesde(r, abajoDerecha)).toEqual(colapsado)
  })
})

describe('ajustes: guardar la posición y el tamaño sin pisarse', () => {
  beforeEach(() => {
    datos.carpeta = mkdtempSync(join(tmpdir(), 'orbe-ajustes-'))
  })

  it('sin archivo, no hay ajustes', () => {
    expect(leerAjustes()).toEqual({})
  })

  it('guardar el tamaño conserva la posición, y al revés', () => {
    guardarAjustes({ posicion: { x: 10, y: 20 } })
    guardarAjustes({ panel: { ancho: 500, alto: 700 } })
    expect(leerAjustes()).toEqual({ posicion: { x: 10, y: 20 }, panel: { ancho: 500, alto: 700 } })
    guardarAjustes({ posicion: { x: 30, y: 40 } })
    expect(leerAjustes()).toEqual({ posicion: { x: 30, y: 40 }, panel: { ancho: 500, alto: 700 } })
  })

  it('un archivo roto se trata como vacío y se puede volver a escribir', () => {
    writeFileSync(join(datos.carpeta, 'ajustes.json'), '{ roto')
    expect(leerAjustes()).toEqual({})
    guardarAjustes({ panel: { ancho: 400, alto: 500 } })
    expect(JSON.parse(readFileSync(join(datos.carpeta, 'ajustes.json'), 'utf8'))).toEqual({ panel: { ancho: 400, alto: 500 } })
  })
})
