import { describe, expect, it } from 'vitest'
import { MAX_HECHO, detectarOrdenRecordar } from '../src/main/memoria/captura'
import { ID_VALIDO, aSlug, parsearNota, serializarNota, tipoDeOrbe, tipoParaArchivo } from '../src/main/memoria/formato'
import { buscarSensible } from '../src/main/memoria/secretos'

const NOTA_CLAUDE = `---
name: user-estudiante-delega-decisiones
description: "Quién es el usuario (estudiante hispanohablante) y cómo prefiere trabajar: delega decisiones y quiere explicaciones breves"
metadata:
  node_type: memory
  type: user
  originSessionId: 721a3ad2-6cf3-457b-a5ee-e5c467d185c4
  modified: 2026-10-03T19:12:15.936Z
---

El usuario es estudiante y escribe en español.

**Why:** prefiere avanzar y ver resultados.
`

describe('parsearNota', () => {
  it('lee una nota de la memoria de Claude: nombre, resumen, tipo, metadatos y texto', () => {
    const n = parsearNota(NOTA_CLAUDE, 'user-estudiante-delega-decisiones.md')
    expect(n.nombre).toBe('user-estudiante-delega-decisiones')
    expect(n.descripcion).toBe('Quién es el usuario (estudiante hispanohablante) y cómo prefiere trabajar: delega decisiones y quiere explicaciones breves')
    expect(n.tipo).toBe('user')
    expect(n.meta['modified']).toBe('2026-10-03T19:12:15.936Z')
    expect(n.meta['node_type']).toBe('memory')
    expect(n.meta['type']).toBeUndefined()
    expect(n.cuerpo).toBe('El usuario es estudiante y escribe en español.\n\n**Why:** prefiere avanzar y ver resultados.')
  })

  it('lee igual un archivo con saltos de línea de Windows y con BOM', () => {
    const windows = `\uFEFF${NOTA_CLAUDE.replace(/\n/g, '\r\n')}`
    expect(parsearNota(windows, 'x.md')).toEqual(parsearNota(NOTA_CLAUDE, 'x.md'))
  })

  it('entiende las comillas dobles con escapes (rutas de Windows) y las simples', () => {
    const doble = parsearNota(
      String.raw`---
name: a
description: "Carpeta C:\\Users\\yo y «comillas» \"dentro\""
---
cuerpo`,
      'a.md'
    )
    expect(doble.descripcion).toBe('Carpeta C:\\Users\\yo y «comillas» "dentro"')
    const simple = parsearNota("---\nname: a\ndescription: 'no me llames ''Orbe'''\n---\ncuerpo", 'a.md')
    expect(simple.descripcion).toBe("no me llames 'Orbe'")
    const plano = parsearNota('---\nname: a\ndescription: texto sin comillas: con dos puntos\n---\ncuerpo', 'a.md')
    expect(plano.descripcion).toBe('texto sin comillas: con dos puntos')
  })

  it('acepta el tipo suelto en la cabecera si no hay bloque metadata', () => {
    const n = parsearNota('---\nname: a\ndescription: d\ntype: project\n---\ncuerpo', 'a.md')
    expect(n.tipo).toBe('project')
  })

  it('sin cabecera, todo es el texto y la primera línea hace de resumen; el nombre sale del archivo', () => {
    const n = parsearNota('\nMi color favorito es el verde.\nY el azul.\n', 'color-favorito.md')
    expect(n).toMatchObject({ nombre: 'color-favorito', descripcion: 'Mi color favorito es el verde.', tipo: 'note' })
    expect(n.cuerpo).toBe('Mi color favorito es el verde.\nY el azul.')
  })

  it('sin resumen en la cabecera usa la primera línea del texto', () => {
    const n = parsearNota('---\nname: a\n---\nPrimera línea\nSegunda', 'a.md')
    expect(n.descripcion).toBe('Primera línea')
  })

  it('ignora líneas raras de la cabecera sin romperse', () => {
    const n = parsearNota('---\nname: a\n# comentario\nesto no es clave valor\ndescription: d\nmetadata:\n  type: feedback\n  :mala\n---\ncuerpo', 'a.md')
    expect(n).toMatchObject({ nombre: 'a', descripcion: 'd', tipo: 'feedback', cuerpo: 'cuerpo' })
  })
})

describe('serializarNota', () => {
  it('escribe y vuelve a leer lo mismo, incluso con comillas, dos puntos, acentos y saltos de línea', () => {
    const nota = {
      nombre: 'nota-prueba',
      descripcion: 'Dijo: "hola, qué tal" — con ñ y C:\\ruta',
      tipo: 'note',
      cuerpo: 'Línea 1\n\nLínea 3 con ---\n---\ny más',
      meta: { origen: 'usuario', usar: 'true', completo: 'false', modified: '2026-10-04T10:00:00.000Z' }
    }
    const texto = serializarNota(nota)
    expect(texto.startsWith('---\nname: "nota-prueba"\n')).toBe(true)
    expect(parsearNota(texto, 'nota-prueba.md')).toEqual(nota)
  })

  it('un valor de metadatos con espacios o símbolos se escribe entre comillas', () => {
    const texto = serializarNota({ nombre: 'a', descripcion: 'd', tipo: 'note', cuerpo: 'c', meta: { origen: 'mi carpeta: x' } })
    expect(parsearNota(texto, 'a.md').meta['origen']).toBe('mi carpeta: x')
  })
})

describe('tipos, nombres y identificadores', () => {
  it.each([
    ['user', 'usuario'],
    ['feedback', 'preferencia'],
    ['project', 'proyecto'],
    ['USER', 'usuario'],
    ['reference', 'nota'],
    ['note', 'nota'],
    ['cosa-rara', 'nota']
  ])('tipo de Claude «%s» → %s', (claude, orbe) => {
    expect(tipoDeOrbe(claude)).toBe(orbe)
  })

  it('al escribir un archivo se usan los nombres de Claude', () => {
    expect(['usuario', 'preferencia', 'proyecto', 'nota'].map((t) => tipoParaArchivo(t as 'usuario'))).toEqual(['user', 'feedback', 'project', 'note'])
  })

  it.each([
    ['Tortilla de Patatas!', 'tortilla-de-patatas'],
    ['Canción número 7', 'cancion-numero-7'],
    ['  --raro__nombre--  ', 'raro__nombre'],
    ['!!!', 'nota'],
    ['', 'nota'],
    ['a'.repeat(100), 'a'.repeat(60)]
  ])('aSlug(%j) → %j', (entrada, esperado) => {
    expect(aSlug(entrada)).toBe(esperado)
  })

  it('un identificador válido nunca puede salirse de la carpeta', () => {
    for (const bueno of ['nota-1', 'user-perfil', 'a', 'x_y-z9']) expect(ID_VALIDO.test(bueno)).toBe(true)
    for (const malo of ['../x', '..\\x', 'a/b', 'A', '', '-x', '_x', 'con espacio', 'a.md', 'a'.repeat(81)]) {
      expect(ID_VALIDO.test(malo)).toBe(false)
    }
  })
})

describe('buscarSensible', () => {
  // Las claves de mentira se arman al vuelo para que ningún escáner las confunda con claves reales del repositorio.
  const falsas: Array<[string, string]> = [
    ['una clave de API', 'sk-ant-' + 'api03-' + 'Ab1'.repeat(10)],
    ['una clave de API', 'sk-' + 'A1'.repeat(20)],
    ['una clave secreta', 'sb_secret_' + 'abcDEF123456'],
    ['un token de GitHub', 'ghp_' + 'A1b2'.repeat(10)],
    ['una clave de AWS', 'AKIA' + 'ABCDEFGHIJKLMNOP'],
    ['una clave de Google', 'AIza' + 'A1b2C3d4'.repeat(4)],
    ['un token de Slack', 'xoxb-' + '123456789012-abcdefghijkl'],
    ['un token de sesión (JWT)', 'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0' + '.' + 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV'],
    ['una clave privada', '-----BEGIN RSA PRIVATE KEY-----'],
    ['un token de acceso', 'Authorization: Bearer ' + 'abcdefghij0123456789klmnop'],
    ['una dirección con usuario y contraseña', 'postgres://' + 'usuario:secreto@localhost/db'],
    ['un número de la seguridad social', '123-45-6789'],
    ['un documento de identidad', '12345678Z'],
    ['un documento de identidad', 'X1234567L'],
    ['una cadena que parece una clave', 'Ab1Cd2'.repeat(8)]
  ]
  it.each(falsas)('detecta %s', (motivo, texto) => {
    expect(buscarSensible(`mira esto: ${texto} gracias`)).toBe(motivo)
  })

  it.each([
    'mi contraseña es hunter22',
    'La password: Sup3rS3cret',
    'el PIN = 4821',
    'api key es abcd1234efgh',
    'mi clave de acceso es sol123'
  ])('detecta una frase con una contraseña: %s', (texto) => {
    expect(buscarSensible(texto)).toBe('una contraseña o una clave')
  })

  it('detecta tarjetas (solo las que pasan la comprobación de Luhn) y cuentas bancarias', () => {
    expect(buscarSensible('mi tarjeta es 4111 1111 1111 1111')).toBe('un número de tarjeta')
    expect(buscarSensible('4111-1111-1111-1111')).toBe('un número de tarjeta')
    expect(buscarSensible('el número 4111 1111 1111 1112 no es una tarjeta')).toBeNull()
    expect(buscarSensible('mi IBAN es ES91 2100 0418 4502 0005 1332')).toBe('un número de cuenta bancaria')
  })

  it.each([
    'Me gusta la ciencia, la historia y los videojuegos de aventura.',
    'Mi número favorito es el 7 y nací en 2004.',
    'La contraseña es importante, pero no la voy a decir.',
    'Hay que cambiar la contraseña cada año.',
    'El token es opcional en esta ruta.',
    'Netlify site id 36f3d37d-b49c-4930-a78a-a2bb6ea55681 y proyecto kbwtrtuoamsljedabhfx',
    'Nunca revelar la clave `sb_secret_…`; solo la publishable.',
    'La clave publishable es pública: sb_publishable_abc123',
    'Ejecutar con --proxy-path "<url con token>" desde publicar/',
    'Plan en C:\\Users\\USUARIO\\.claude\\plans\\pasted-content-id-7162-rol-gleaming-whale.md',
    'El commit 571b821c0ffee5d2e8d1f3a4b5c6d7e8f9a0b1c2 está en main',
    'Carpeta C:\\Users\\USUARIO\\proyectos\\orbe y versión 2.1.289',
    'Llámame al +34 600 123 456 mañana',
    'Quedamos el 2026-10-04 a las 18:30'
  ])('no se asusta de la prosa normal: %s', (texto) => {
    expect(buscarSensible(texto)).toBeNull()
  })
})

describe('detectarOrdenRecordar', () => {
  it.each([
    ['Recuerda que mi número favorito es el 7', 'Mi número favorito es el 7'],
    ['recuerda: soy alérgico a los frutos secos.', 'Soy alérgico a los frutos secos'],
    ['Recuerda esto: la reunión es a las 5', 'La reunión es a las 5'],
    ['Recuerda lo siguiente: vivo en Valencia', 'Vivo en Valencia'],
    ['Oye, ten en cuenta que estudio por las tardes', 'Estudio por las tardes'],
    ['Por favor, no olvides que mi cumpleaños es el 3 de mayo', 'Mi cumpleaños es el 3 de mayo'],
    ['no te olvides de que prefiero respuestas cortas', 'Prefiero respuestas cortas'],
    ['Acuérdate de que uso Windows 11', 'Uso Windows 11'],
    ['acuérdate que me gusta el anime cálido', 'Me gusta el anime cálido'],
    ['Guarda en tu memoria que mi gato se llama Neo', 'Mi gato se llama Neo'],
    ['apunta en la memoria: mi color es el verde', 'Mi color es el verde'],
    ['Memoriza que programo en TypeScript', 'Programo en TypeScript'],
    ['Apunta que mi color favorito es el verde', 'Mi color favorito es el verde'],
    ['Anota: tengo clase los martes', 'Tengo clase los martes'],
    ['Remember that I like short answers', 'I like short answers'],
    ['  Recuerda que   me gusta  la   tortilla  ', 'Me gusta la tortilla'],
    ['Recuerda que "mi equipo es el Barça"', 'Mi equipo es el Barça']
  ])('«%s» guarda «%s»', (mensaje, hecho) => {
    expect(detectarOrdenRecordar(mensaje)).toEqual({ hecho })
  })

  it.each([
    ['una pregunta', '¿Recuerdas que me gusta el té?'],
    ['una pregunta después', 'Recuerda que mi número favorito es el 7, ¿cuál era?'],
    ['un recordatorio (no es memoria)', 'Recuérdame llamar a mamá a las 5'],
    ['recuerda sin «que»', 'Recuerda cómo se hacía la tortilla'],
    ['varias frases', 'Recuerda que mi número favorito es el 7. Preséntate en una frase.'],
    ['frases con punto y coma', 'Recuerda que soy alérgico; no me des frutos secos'],
    ['sin dato', 'Recuerda que'],
    ['dato demasiado corto', 'Recuerda que a'],
    ['sin disparador', 'Mi número favorito es el 7'],
    ['disparador a medias', 'No recuerdo qué dijiste'],
    ['«apunta» sin «que»', 'Apunta hacia el norte con la flecha'],
    ['disparador que no está al principio', 'Dime una cosa y recuerda que me gusta el té'],
    ['mensaje vacío', '   '],
    ['demasiadas líneas', 'Recuerda que:\nuna cosa\notra cosa\ny otra más']
  ])('no lo toma por una orden: %s', (_motivo, mensaje) => {
    expect(detectarOrdenRecordar(mensaje)).toBeNull()
  })

  it('un dato demasiado largo no se guarda', () => {
    expect(detectarOrdenRecordar(`Recuerda que ${'x'.repeat(MAX_HECHO + 1)}`)).toBeNull()
    expect(detectarOrdenRecordar(`Recuerda que ${'x'.repeat(MAX_HECHO)}`)).not.toBeNull()
  })
})
