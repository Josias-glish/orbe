import { describe, expect, it } from 'vitest'
import { ErrorChat } from '../src/main/chat/errores'
import {
  AVISO_NEGRA,
  LADO_MAX,
  LADO_MINIATURA,
  MAX_BYTES_JPEG,
  RETRASO_OCULTAR_MS,
  ServicioCaptura,
  dimensionesReducidas,
  esMuestraNegra,
  type DepsCaptura,
  type ImagenNativa
} from '../src/main/pantalla/captura'
import { esPreguntaVisual } from '../src/shared/visual'

interface OpcionesImagen {
  negra?: boolean
  /** Cuánto pesa el JPEG según el lado mayor y la calidad. */
  bytes?: (lado: number, calidad: number) => number
}

/** Una imagen de mentira que recuerda cómo se la redujo y se la codificó. */
function imagen(ancho: number, alto: number, opciones: OpcionesImagen = {}, registro: string[] = []): ImagenNativa {
  return {
    tamano: () => ({ ancho, alto }),
    reducir(maxLado) {
      const d = dimensionesReducidas(ancho, alto, maxLado)
      registro.push(`reducir:${maxLado}`)
      return imagen(d.ancho, d.alto, opciones, registro)
    },
    aJpeg(calidad) {
      registro.push(`jpeg:${Math.max(ancho, alto)}@${calidad}`)
      const n = opciones.bytes ? opciones.bytes(Math.max(ancho, alto), calidad) : 1000
      const datos = new Uint8Array(n)
      datos[0] = 0xff
      datos[1] = 0xd8
      return datos
    },
    esNegra: () => opciones.negra ?? false
  }
}

function montar(extra: Partial<DepsCaptura> & { imagen?: ImagenNativa | null } = {}) {
  const eventos: string[] = []
  const registro: string[] = []
  const { imagen: img, ...resto } = extra
  const deps: DepsCaptura = {
    elegirPantalla: async () => {
      eventos.push('elegir')
      return 'monitor-2'
    },
    ocultar: () => eventos.push('ocultar'),
    restaurar: () => eventos.push('restaurar'),
    esperar: async (ms) => {
      eventos.push(`esperar:${ms}`)
    },
    tomar: async (destino) => {
      eventos.push(`tomar:${String(destino)}`)
      return img === undefined ? imagen(1920, 1080, {}, registro) : img
    },
    ...resto
  }
  return { servicio: new ServicioCaptura(deps), eventos, registro }
}

async function errorDe(promesa: Promise<unknown>): Promise<ErrorChat> {
  try {
    await promesa
  } catch (e) {
    expect(e).toBeInstanceOf(ErrorChat)
    return e as ErrorChat
  }
  throw new Error('Se esperaba un error y no hubo ninguno')
}

describe('dimensionesReducidas', () => {
  it('reduce el lado mayor conservando la proporción', () => {
    expect(dimensionesReducidas(1920, 1080, 1500)).toEqual({ ancho: 1500, alto: 844 })
    expect(dimensionesReducidas(1080, 1920, 1500)).toEqual({ ancho: 844, alto: 1500 })
    expect(dimensionesReducidas(3840, 2160, 1500)).toEqual({ ancho: 1500, alto: 844 })
  })

  it('nunca agranda', () => {
    expect(dimensionesReducidas(800, 600, 1500)).toEqual({ ancho: 800, alto: 600 })
    expect(dimensionesReducidas(1500, 900, 1500)).toEqual({ ancho: 1500, alto: 900 })
  })

  it('una imagen finísima no se queda sin lado', () => {
    expect(dimensionesReducidas(10_000, 3, 1500).alto).toBe(1)
  })
})

describe('esMuestraNegra', () => {
  const lienzo = (valor: number, pixeles = 200_000): Uint8Array => new Uint8Array(pixeles * 4).fill(valor)

  it('una imagen negra lo es; una con contenido, no', () => {
    expect(esMuestraNegra(lienzo(0))).toBe(true)
    expect(esMuestraNegra(lienzo(3))).toBe(true)
    expect(esMuestraNegra(lienzo(128))).toBe(false)
    expect(esMuestraNegra(lienzo(255))).toBe(false)
  })

  it('un fondo oscuro con algo de brillo (un tema oscuro con texto) no es una captura negra', () => {
    const datos = lienzo(4)
    for (let i = 0; i < datos.length; i += 4 * 997) datos[i] = datos[i + 1] = datos[i + 2] = 200 // puntos brillantes en la muestra
    expect(esMuestraNegra(datos)).toBe(false)
  })

  it('sin píxeles no hay veredicto', () => {
    expect(esMuestraNegra(new Uint8Array(0))).toBe(false)
  })
})

describe('esPreguntaVisual', () => {
  it.each([
    '¿Cómo se ve este diseño?',
    'Describe la imagen',
    '¿Qué colores tiene el logo?',
    'Mira esto, no me cuadra',
    '¿Qué hay en mi pantalla?',
    'El botón se ve cortado',
    'Analiza este gráfico',
    'Explícame el diagrama',
    'Cómo queda la interfaz',
    '¿Es una captura de error?',
    'qué es lo que ves'
  ])('«%s» parece visual', (texto) => {
    expect(esPreguntaVisual(texto)).toBe(true)
  })

  it.each([
    '¿Cuál es la capital de Francia?',
    'Resume este texto',
    'Explícame esta función',
    'Traduce al inglés',
    'Recuerda que mi número favorito es el 7',
    '',
    'Los colorantes alimentarios',
    'La imaginación vuela'
  ])('«%s» no lo parece', (texto) => {
    expect(esPreguntaVisual(texto)).toBe(false)
  })
})

describe('ServicioCaptura', () => {
  it('elige pantalla, oculta Orbe, espera, captura y devuelve Orbe a su sitio, en ese orden', async () => {
    const { servicio, eventos } = montar()
    await servicio.capturar()
    expect(eventos).toEqual(['elegir', 'ocultar', `esperar:${RETRASO_OCULTAR_MS}`, 'tomar:monitor-2', 'restaurar'])
  })

  it('deja la imagen a ~1500 px en JPEG, con su resumen y una miniatura para la vista previa', async () => {
    const { servicio, registro } = montar({ imagen: imagen(1920, 1080, { bytes: () => 212 * 1024 }, []) })
    const c = await servicio.capturar()
    expect(c.imagen).toMatchObject({ tipoMime: 'image/jpeg', ancho: 1500, alto: 844 })
    expect(Buffer.from(c.imagen.base64, 'base64').length).toBe(212 * 1024)
    expect(Buffer.from(c.imagen.base64, 'base64').subarray(0, 2).toString('hex')).toBe('ffd8')
    expect(c.parte).toMatchObject({ clave: 'imagen', etiqueta: 'Captura', resumen: '1500×844 · 212 KB' })
    expect(c.parte.miniatura).toMatch(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
    expect(c.parte.vista).toMatch(/viajará con tu próximo mensaje/)
    expect(c.avisos).toEqual([])
    expect(registro).toEqual([])
  })

  it('codifica con la calidad normal y saca la miniatura de la imagen ya reducida', async () => {
    const registro: string[] = []
    const { servicio } = montar({ imagen: imagen(1920, 1080, {}, registro) })
    await servicio.capturar()
    expect(registro).toEqual([`reducir:${LADO_MAX}`, 'jpeg:1500@85', `reducir:${LADO_MINIATURA}`, 'jpeg:360@70'])
  })

  it('una pantalla pequeña no se agranda', async () => {
    const { servicio } = montar({ imagen: imagen(1280, 720) })
    expect((await servicio.capturar()).imagen).toMatchObject({ ancho: 1280, alto: 720 })
  })

  it('si pesa demasiado baja la calidad y, si hace falta, el tamaño', async () => {
    const registro: string[] = []
    const pesada = imagen(1920, 1080, { bytes: (lado, calidad) => (lado === 1500 && calidad === 85 ? MAX_BYTES_JPEG + 1 : lado === 1500 ? MAX_BYTES_JPEG + 1 : 1000) }, registro)
    const { servicio } = montar({ imagen: pesada })
    const c = await servicio.capturar()
    expect(c.imagen.ancho).toBe(1200)
    expect(registro).toContain('jpeg:1500@85')
    expect(registro).toContain('jpeg:1500@70')
    expect(registro).toContain('jpeg:1200@70')
  })

  it('si no hay manera de que pese menos, falla con un error claro', async () => {
    const { servicio } = montar({ imagen: imagen(1920, 1080, { bytes: () => MAX_BYTES_JPEG + 1 }) })
    const e = await errorDe(servicio.capturar())
    expect(e.error.codigo).toBe('captura_no_disponible')
    expect(e.error.detalle).toMatch(/pesa demasiado/)
  })

  it('avisa si la captura salió negra', async () => {
    const { servicio } = montar({ imagen: imagen(1920, 1080, { negra: true }) })
    expect((await servicio.capturar()).avisos).toEqual([AVISO_NEGRA])
  })

  it('Orbe vuelve siempre, también si falla la captura o la espera', async () => {
    const fallaTomar = montar({
      tomar: async () => {
        throw new Error('Acceso denegado')
      }
    })
    const e = await errorDe(fallaTomar.servicio.capturar())
    expect(e.error.codigo).toBe('captura_no_disponible')
    expect(e.error.detalle).toBe('Acceso denegado')
    expect(fallaTomar.eventos.at(-1)).toBe('restaurar')

    const fallaEspera = montar({
      esperar: async () => {
        throw new Error('se cortó')
      }
    })
    await errorDe(fallaEspera.servicio.capturar())
    expect(fallaEspera.eventos).toEqual(['elegir', 'ocultar', 'restaurar'])
  })

  it('si Windows no devuelve ninguna imagen, lo dice y devuelve Orbe', async () => {
    const { servicio, eventos } = montar({ imagen: null })
    const e = await errorDe(servicio.capturar())
    expect(e.error.codigo).toBe('captura_no_disponible')
    expect(e.error.detalle).toMatch(/ninguna imagen/)
    expect(eventos.at(-1)).toBe('restaurar')
  })

  it('si no se sabe qué pantalla, captura la de por defecto en lugar de fallar', async () => {
    const { servicio, eventos } = montar({
      elegirPantalla: async () => {
        throw new Error('el lector no responde')
      }
    })
    await servicio.capturar()
    expect(eventos).toContain('tomar:undefined')
  })

  it('un doble clic comparte la misma captura (Orbe se oculta una sola vez); la siguiente petición hace otra', async () => {
    let tomadas = 0
    const { servicio, eventos } = montar({
      tomar: async () => {
        tomadas++
        return imagen(1920, 1080)
      }
    })
    const [a, b] = await Promise.all([servicio.capturar(), servicio.capturar()])
    expect(a).toBe(b)
    expect(tomadas).toBe(1)
    expect(eventos.filter((e) => e === 'ocultar')).toHaveLength(1)
    await servicio.capturar()
    expect(tomadas).toBe(2)
  })

  it('una captura fallida no bloquea las siguientes', async () => {
    let falla = true
    const { servicio } = montar({
      tomar: async () => {
        if (falla) throw new Error('x')
        return imagen(1920, 1080)
      }
    })
    await errorDe(servicio.capturar())
    falla = false
    await expect(servicio.capturar()).resolves.toBeDefined()
  })
})
