import { describe, expect, it } from 'vitest'
import { contarLetras, contenidoUtil, MINIMO_LETRAS_UTIL, MINIMO_PALABRAS_UTIL } from '../src/main/pantalla/heuristica'
import { limpiarTexto, normalizarBarra, sanearUrl, vistaPrevia } from '../src/main/pantalla/limpieza'

describe('limpiarTexto', () => {
  it('normaliza los saltos de línea (el Bloc de notas devuelve «\\r»)', () => {
    expect(limpiarTexto('uno\r\ndos\rtres\ncuatro', 100).texto).toBe('uno\ndos\ntres\ncuatro')
  })

  it('quita invisibles, controles y espacios duros', () => {
    const sucio = 'a\u200Bb\u0000c\uFEFFd\u202Ee\u00A0f'
    expect(limpiarTexto(sucio, 100).texto).toBe('abcde f')
  })

  it('quita los espacios del final de cada línea y comprime las líneas en blanco', () => {
    const texto = '  uno   \n\n\n\n   \ndos\t\t\n\n\ntres  '
    expect(limpiarTexto(texto, 100).texto).toBe('uno\n\ndos\n\ntres')
  })

  it('no recorta si cabe y cuenta los caracteres ya limpios', () => {
    const r = limpiarTexto('hola\n\n\n\nmundo', 100)
    expect(r).toEqual({ texto: 'hola\n\nmundo', recortado: false, caracteresOriginales: 11 })
  })

  it('un texto vacío o solo de espacios queda vacío', () => {
    expect(limpiarTexto('', 10).texto).toBe('')
    expect(limpiarTexto(' \r\n \t ', 10)).toEqual({ texto: '', recortado: false, caracteresOriginales: 0 })
  })

  it('recorta al máximo y avisa; la longitud original es la del texto limpio', () => {
    const r = limpiarTexto('x'.repeat(500), 100)
    expect(r.recortado).toBe(true)
    expect(r.texto).toHaveLength(100)
    expect(r.caracteresOriginales).toBe(500)
  })

  it('prefiere cortar en un salto de línea si está cerca del límite', () => {
    const texto = `${'a'.repeat(90)}\n${'b'.repeat(90)}`
    const r = limpiarTexto(texto, 100)
    expect(r.recortado).toBe(true)
    expect(r.texto).toBe('a'.repeat(90))
  })

  it('si el salto de línea queda lejos, corta en el máximo', () => {
    const texto = `${'a'.repeat(10)}\n${'b'.repeat(200)}`
    const r = limpiarTexto(texto, 100)
    expect(r.texto).toHaveLength(100)
  })

  it('no parte un emoji por la mitad al recortar', () => {
    const r = limpiarTexto('a'.repeat(99) + '😀' + 'b'.repeat(50), 100)
    expect(r.recortado).toBe(true)
    expect(r.texto).toBe('a'.repeat(99))
    expect(r.texto).not.toMatch(/[\ud800-\udbff]$/)
  })

  it('conserva los acentos, la ñ y el código tal cual', () => {
    const texto = 'Canción: «El niño» — función f(x) { return x < 2 ? 1 : 0 }'
    expect(limpiarTexto(texto, 200).texto).toBe(texto)
  })
})

describe('sanearUrl', () => {
  it('quita la consulta y el fragmento, y avisa de que lo hizo', () => {
    expect(sanearUrl('https://example.com/recetas/tortilla?utm_source=a&sesion=abc#paso-2')).toEqual({
      url: 'https://example.com/recetas/tortilla',
      parametrosOmitidos: true
    })
  })

  it('quita las credenciales incrustadas', () => {
    const r = sanearUrl('https://usuario:secreto@example.com/panel')
    expect(r?.url).toBe('https://example.com/panel')
    expect(r?.parametrosOmitidos).toBe(true)
    expect(r?.url).not.toContain('secreto')
  })

  it('una URL limpia queda igual y no avisa', () => {
    expect(sanearUrl('https://es.wikipedia.org/wiki/Orbe')).toEqual({
      url: 'https://es.wikipedia.org/wiki/Orbe',
      parametrosOmitidos: false
    })
  })

  it('un signo de pregunta vacío también cuenta como consulta (no queda rastro)', () => {
    expect(sanearUrl('https://example.com/a?')?.url).toBe('https://example.com/a')
  })

  it('acepta archivos locales y conserva la ruta', () => {
    expect(sanearUrl('file:///C:/Users/yo/notas.txt')?.url).toBe('file:///C:/Users/yo/notas.txt')
  })

  it.each([null, undefined, '', 'no es una url', 'example.com/sin-esquema'])('devuelve null para %s', (v) => {
    expect(sanearUrl(v)).toBeNull()
  })
})

describe('normalizarBarra', () => {
  it.each([
    ['example.com/ruta', 'https://example.com/ruta'],
    ['  example.com  ', 'https://example.com'],
    ['localhost:5173/app', 'https://localhost:5173/app'],
    ['192.168.1.1', 'https://192.168.1.1'],
    ['sub.dominio.es?x=1', 'https://sub.dominio.es?x=1'],
    ['https://example.com/a', 'https://example.com/a'],
    ['http://example.com', 'http://example.com'],
    ['chrome://settings', 'chrome://settings'],
    ['edge://flags', 'edge://flags'],
    ['C:/Users/yo/doc.html', 'file:///C:/Users/yo/doc.html'],
    ['C:\\Users\\yo\\doc.html', 'file:///C:/Users/yo/doc.html']
  ])('«%s» → %s', (entrada, esperado) => {
    expect(normalizarBarra(entrada)).toBe(esperado)
  })

  it.each([null, undefined, '', '   ', 'busca algo en google', 'palabra', 'dos palabras.com'])(
    'no confunde «%s» con una dirección',
    (v) => {
      expect(normalizarBarra(v)).toBeNull()
    }
  )
})

describe('vistaPrevia', () => {
  it('no toca lo que cabe y recorta con puntos suspensivos lo que no', () => {
    expect(vistaPrevia('hola', 10)).toBe('hola')
    expect(vistaPrevia('hola mundo grande', 10)).toBe('hola mundo…')
  })
})

describe('contarLetras', () => {
  it('cuenta letras y dígitos de cualquier idioma, no signos ni espacios', () => {
    expect(contarLetras('Hola, ¿qué tal? 123')).toBe(13)
    expect(contarLetras('日本語のテキスト')).toBe(8)
    expect(contarLetras('— … ¡! \n\t')).toBe(0)
  })
})

describe('contenidoUtil', () => {
  const palabras = (n: number): string => Array.from({ length: n }, () => 'palabra').join(' ')

  it('vacío, nulo o solo menús: no es útil', () => {
    expect(contenidoUtil(null)).toBe(false)
    expect(contenidoUtil(undefined)).toBe(false)
    expect(contenidoUtil('')).toBe(false)
    expect(contenidoUtil('Archivo\nEditar\nVer\nAyuda')).toBe(false)
  })

  it('exige un mínimo de letras y de palabras', () => {
    // Pocas palabras (y pocas letras): no.
    expect(contenidoUtil(palabras(MINIMO_PALABRAS_UTIL - 1))).toBe(false)
    // Palabras de sobra y letras de sobra: sí.
    expect(contarLetras(palabras(MINIMO_PALABRAS_UTIL + 5))).toBeGreaterThanOrEqual(MINIMO_LETRAS_UTIL)
    expect(contenidoUtil(palabras(MINIMO_PALABRAS_UTIL + 5))).toBe(true)
    // Muchas letras pero una sola «palabra» (una cadena larga): tampoco.
    expect(contenidoUtil('x'.repeat(MINIMO_LETRAS_UTIL * 2))).toBe(false)
  })

  it('un párrafo normal sí lo es', () => {
    const parrafo =
      'Pela y corta las patatas en láminas finas y pocha las patatas con la cebolla a fuego lento durante veinte minutos. ' +
      'Bate los huevos con una pizca de sal y mezcla con las patatas escurridas.'
    expect(contenidoUtil(parrafo)).toBe(true)
  })
})
