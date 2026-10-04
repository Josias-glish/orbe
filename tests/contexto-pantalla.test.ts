import { describe, expect, it, vi } from 'vitest'
import { ErrorChat } from '../src/main/chat/errores'
import {
  ServicioPantalla,
  VISTA_MAX,
  describirVentana,
  type ContenidoUia,
  type FuenteUia,
  type TextoUia,
  type VentanaUia
} from '../src/main/pantalla/contexto'
import { ErrorHelper } from '../src/main/pantalla/helper-uia'

const PARRAFO =
  'Pela y corta las patatas en láminas finas y pocha las patatas con la cebolla a fuego lento durante veinte minutos. ' +
  'Bate los huevos con una pizca de sal y mezcla con las patatas escurridas. Déjala reposar unos minutos antes de servir.'

const VENTANA: VentanaUia = {
  hwnd: 7,
  pid: 100,
  proceso: 'chrome',
  aplicacion: 'Google Chrome',
  titulo: '  Receta de tortilla - Cocina fácil  ',
  esNavegador: true,
  url: 'https://example.com/recetas/tortilla?utm_source=correo&sesion=abc123',
  barra: null,
  primerPlano: true,
  restringida: false
}

interface Guion {
  ventana?: VentanaUia | null | Error
  seleccion?: string | null | Error
  contenido?: string | null | Error
}

/** Una fuente de pantalla de mentira que sigue un guion y recuerda cómo se la llamó. */
function fuente(guion: Guion = {}): FuenteUia & { llamadas: string[]; ventana: ReturnType<typeof vi.fn> } {
  const llamadas: string[] = []
  const resolver = <T>(valor: T | Error): T => {
    if (valor instanceof Error) throw valor
    return valor
  }
  return {
    llamadas,
    ventana: vi.fn(async (): Promise<VentanaUia | null> => {
      llamadas.push('ventana')
      return resolver(guion.ventana === undefined ? VENTANA : guion.ventana)
    }),
    async seleccion(): Promise<TextoUia> {
      llamadas.push('seleccion')
      const texto = resolver(guion.seleccion ?? null)
      return { texto, metodo: texto ? 'foco' : null }
    },
    async contenido(): Promise<ContenidoUia> {
      llamadas.push('contenido')
      const texto = resolver(guion.contenido ?? null)
      return { texto, metodo: texto ? 'documento' : null, parcial: false }
    }
  }
}

const servicio = (f: FuenteUia, contextoMax = 8000): ServicioPantalla => new ServicioPantalla(f, { contextoMax })
const claves = (r: Awaited<ReturnType<ServicioPantalla['leer']>>): string[] => r.lectura.partes.map((p) => p.clave)

describe('ServicioPantalla: prioridad de lo que se lee', () => {
  it('con texto seleccionado, envía ventana y selección y no lee el contenido entero', async () => {
    const f = fuente({ seleccion: 'da la vuelta con la ayuda de un plato', contenido: PARRAFO })
    const r = await servicio(f).leer()
    expect(claves(r)).toEqual(['ventana', 'seleccion'])
    expect(r.contexto.seleccion).toBe('da la vuelta con la ayuda de un plato')
    expect(r.contexto.contenido).toBeUndefined()
    expect(f.llamadas).toEqual(['ventana', 'seleccion']) // ni siquiera pide el contenido
    expect(r.lectura.sugerirCaptura).toBe(false)
  })

  it('sin selección, envía ventana y contenido', async () => {
    const r = await servicio(fuente({ contenido: PARRAFO })).leer()
    expect(claves(r)).toEqual(['ventana', 'contenido'])
    expect(r.contexto.contenido).toBe(PARRAFO)
    expect(r.contexto.seleccion).toBeUndefined()
    expect(r.lectura.sugerirCaptura).toBe(false)
    expect(r.lectura.avisos).toEqual([])
  })

  it('una selección de solo espacios no cuenta como selección', async () => {
    const r = await servicio(fuente({ seleccion: '  \r\n ', contenido: PARRAFO })).leer()
    expect(claves(r)).toEqual(['ventana', 'contenido'])
  })

  it('la ventana siempre viaja, con el título sin espacios sobrantes', async () => {
    const r = await servicio(fuente({ contenido: PARRAFO })).leer()
    expect(r.contexto.ventana).toEqual({
      aplicacion: 'Google Chrome',
      titulo: 'Receta de tortilla - Cocina fácil',
      url: 'https://example.com/recetas/tortilla'
    })
  })
})

describe('ServicioPantalla: direcciones web', () => {
  it('quita los parámetros de la URL y lo dice en la vista previa', async () => {
    const r = await servicio(fuente({ contenido: PARRAFO })).leer()
    const parte = r.lectura.partes[0]
    expect(parte.vista).toContain('Dirección: https://example.com/recetas/tortilla\n')
    expect(parte.vista).toContain('Se han omitido los parámetros')
    expect(JSON.stringify(r.contexto)).not.toMatch(/utm_source|abc123/)
  })

  it('si el helper no da la URL, usa el texto de la barra de direcciones', async () => {
    const v = { ...VENTANA, url: null, barra: 'example.com/otra/ruta?token=secreto' }
    const r = await servicio(fuente({ ventana: v, contenido: PARRAFO })).leer()
    expect(r.contexto.ventana?.url).toBe('https://example.com/otra/ruta')
    expect(JSON.stringify(r.contexto)).not.toContain('secreto')
  })

  it('una ventana que no es un navegador no lleva dirección aunque el helper la traiga', async () => {
    const v = { ...VENTANA, esNavegador: false, proceso: 'notepad', aplicacion: 'Bloc de notas' }
    const r = await servicio(fuente({ ventana: v, contenido: PARRAFO })).leer()
    expect(r.contexto.ventana?.url).toBeUndefined()
    expect(r.lectura.partes[0].vista).not.toContain('Dirección')
  })

  it('una barra con una búsqueda (no una dirección) no se envía', async () => {
    const v = { ...VENTANA, url: null, barra: 'receta de tortilla de patatas' }
    const r = await servicio(fuente({ ventana: v, contenido: PARRAFO })).leer()
    expect(r.contexto.ventana?.url).toBeUndefined()
  })
})

describe('ServicioPantalla: recortes y vistas previas', () => {
  it('recorta al máximo y lo marca, tanto en el contexto como en el chip', async () => {
    const largo = Array.from({ length: 400 }, (_, i) => `Línea número ${i} con algo de texto para rellenar`).join('\n')
    const r = await servicio(fuente({ contenido: largo }), 1000).leer()
    expect(r.contexto.contenido!.length).toBeLessThanOrEqual(1000)
    expect(r.contexto.contenidoRecortado).toBe(true)
    const chip = r.lectura.partes.find((p) => p.clave === 'contenido')!
    expect(chip.recortado).toBe(true)
    expect(chip.resumen).toContain('(recortado)')
    expect(chip.caracteres).toBeGreaterThan(1000)
  })

  it('la selección larga también se recorta y se marca', async () => {
    const r = await servicio(fuente({ seleccion: 'palabra '.repeat(500) }), 500).leer()
    expect(r.contexto.seleccion!.length).toBeLessThanOrEqual(500)
    expect(r.contexto.seleccionRecortada).toBe(true)
  })

  it('el chip enseña como mucho VISTA_MAX caracteres, aunque se envíe más', async () => {
    const r = await servicio(fuente({ contenido: 'abc '.repeat(1500) }), 8000).leer()
    const chip = r.lectura.partes.find((p) => p.clave === 'contenido')!
    expect(chip.vista.length).toBeLessThanOrEqual(VISTA_MAX + 1)
    expect(chip.vista.endsWith('…')).toBe(true)
    expect(r.contexto.contenido!.length).toBeGreaterThan(VISTA_MAX)
  })

  it('el resumen cuenta los caracteres con separador de miles', async () => {
    const r = await servicio(fuente({ contenido: 'x '.repeat(2500) }), 8000).leer()
    const chip = r.lectura.partes.find((p) => p.clave === 'contenido')!
    expect(chip.resumen).toMatch(/^[\d.]+ caracteres$/)
    expect(chip.resumen).toBe(`${new Intl.NumberFormat('es-ES').format(chip.caracteres!)} caracteres`)
  })
})

describe('ServicioPantalla: poco texto, vacío y ventanas que no se dejan leer', () => {
  it('muy poco texto: lo envía pero avisa y sugiere la captura', async () => {
    const r = await servicio(fuente({ contenido: 'Archivo\nEditar\nVer\nAyuda' })).leer()
    expect(claves(r)).toEqual(['ventana', 'contenido'])
    expect(r.lectura.sugerirCaptura).toBe(true)
    expect(r.lectura.avisos).toEqual(['Hay muy poco texto en esa ventana.'])
  })

  it('nada de texto: solo la ventana, con un aviso y la captura sugerida', async () => {
    const r = await servicio(fuente({ contenido: null })).leer()
    expect(claves(r)).toEqual(['ventana'])
    expect(r.lectura.sugerirCaptura).toBe(true)
    expect(r.lectura.avisos).toEqual(['Esa ventana no muestra texto que pueda leer.'])
  })

  it('una ventana restringida explica que puede ser un programa de administrador', async () => {
    const r = await servicio(fuente({ ventana: { ...VENTANA, restringida: true }, contenido: null })).leer()
    expect(r.lectura.avisos[0]).toMatch(/administrador/)
  })

  it('sin ninguna ventana que leer, falla con un error claro', async () => {
    const e = await servicio(fuente({ ventana: null })).leer().catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ErrorChat)
    expect((e as ErrorChat).error.codigo).toBe('sin_ventana')
  })
})

describe('ServicioPantalla: fallos del lector', () => {
  it('si no se puede ni saber la ventana, es «lector no disponible» con el detalle técnico', async () => {
    const e = await servicio(fuente({ ventana: new ErrorHelper('El lector de pantalla se detuvo inesperadamente.') }))
      .leer()
      .catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ErrorChat)
    const { codigo, detalle } = (e as ErrorChat).error
    expect(codigo).toBe('lector_no_disponible')
    expect(detalle).toContain('se detuvo inesperadamente')
  })

  it('un error cualquiera (no del helper) también se traduce', async () => {
    const e = await servicio(fuente({ ventana: new Error('boom') })).leer().catch((x: unknown) => x)
    expect((e as ErrorChat).error.codigo).toBe('lector_no_disponible')
    expect((e as ErrorChat).error.detalle).toBe('boom')
  })

  it('si falla la selección, avisa y sigue con el contenido', async () => {
    const r = await servicio(fuente({ seleccion: new ErrorHelper('timeout'), contenido: PARRAFO })).leer()
    expect(claves(r)).toEqual(['ventana', 'contenido'])
    expect(r.lectura.avisos).toEqual(['No he podido comprobar si hay texto seleccionado.'])
  })

  it('si falla el contenido, devuelve la ventana y lo dice (sin duplicar avisos)', async () => {
    const r = await servicio(fuente({ contenido: new ErrorHelper('timeout') })).leer()
    expect(claves(r)).toEqual(['ventana'])
    expect(r.lectura.avisos).toEqual(['No he podido leer el contenido de esa ventana.'])
    expect(r.lectura.sugerirCaptura).toBe(true)
  })
})

describe('ServicioPantalla: lecturas simultáneas', () => {
  it('dos peticiones a la vez comparten la misma lectura', async () => {
    const f = fuente({ contenido: PARRAFO })
    const s = servicio(f)
    const [a, b] = await Promise.all([s.leer(), s.leer()])
    expect(a).toBe(b)
    expect(f.ventana).toHaveBeenCalledTimes(1)
  })

  it('una lectura posterior vuelve a leer la pantalla (no se queda con la vieja)', async () => {
    const f = fuente({ contenido: PARRAFO })
    const s = servicio(f)
    await s.leer()
    await s.leer()
    expect(f.ventana).toHaveBeenCalledTimes(2)
  })

  it('una lectura fallida no deja bloqueado el servicio', async () => {
    const guion: Guion = { ventana: null }
    const f = fuente(guion)
    const s = servicio(f)
    await expect(s.leer()).rejects.toBeInstanceOf(ErrorChat)
    guion.ventana = VENTANA
    guion.contenido = PARRAFO
    await expect(s.leer()).resolves.toBeDefined()
  })
})

describe('describirVentana', () => {
  it('muestra aplicación, título y, si la hay, la dirección', () => {
    expect(describirVentana({ aplicacion: 'Edge', titulo: 'Inicio', url: 'https://example.com/' })).toBe(
      'Aplicación: Edge\nTítulo: Inicio\nDirección: https://example.com/'
    )
    expect(describirVentana({ aplicacion: 'Bloc de notas', titulo: '' })).toBe('Aplicación: Bloc de notas\nTítulo: (sin título)')
  })
})
