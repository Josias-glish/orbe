import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AlmacenMemoria, huellaContenido, type Recuerdo } from '../src/main/memoria/almacen'
import {
  AlmacenConversacion,
  HISTORIAL_PREVIO_MAX,
  MAX_CARACTERES_MENSAJE,
  construirHistorialPrevio
} from '../src/main/memoria/conversacion'
import { prepararMemoriaDeMentira } from '../src/main/memoria/fuente-demo'
import { carpetasClaudePorDefecto, importarDeClaude } from '../src/main/memoria/importador'

const temporal = (): string => mkdtempSync(join(tmpdir(), 'orbe-mem-'))

function recuerdo(extra: Partial<Recuerdo> = {}): Recuerdo {
  return {
    id: 'nota-prueba',
    tipo: 'nota',
    descripcion: 'Me gusta la tortilla',
    cuerpo: 'Me gusta la tortilla de patatas con cebolla.',
    origen: 'usuario',
    usar: true,
    completo: true,
    modificado: '2026-10-04T10:00:00.000Z',
    ...extra
  }
}

describe('AlmacenMemoria', () => {
  let carpeta: string
  let almacen: AlmacenMemoria
  beforeEach(() => {
    carpeta = join(temporal(), 'memoria')
    almacen = new AlmacenMemoria(carpeta)
  })

  it('sin carpeta, no hay nada y no falla', () => {
    expect(almacen.listar()).toEqual([])
    expect(almacen.obtener('nota-prueba')).toBeNull()
    expect(almacen.existe()).toBe(false)
  })

  it('guarda un recuerdo como un .md legible y lo lee igual', () => {
    const r = recuerdo({ tipo: 'proyecto', origen: 'claude', usar: false, completo: false })
    almacen.guardar(r)
    const archivo = readFileSync(join(carpeta, 'nota-prueba.md'), 'utf8')
    expect(archivo).toContain('description: "Me gusta la tortilla"')
    expect(archivo).toContain('type: project')
    expect(archivo).toContain('Me gusta la tortilla de patatas con cebolla.')
    expect(almacen.obtener('nota-prueba')).toEqual(r)
    expect(almacen.listar()).toEqual([r])
  })

  it('al guardar no deja archivos temporales', () => {
    almacen.guardar(recuerdo())
    almacen.guardarConfig(almacen.config())
    expect(readdirSync(carpeta).sort()).toEqual(['_config.json', 'nota-prueba.md'])
  })

  it('lista primero lo más reciente', () => {
    almacen.guardar(recuerdo({ id: 'vieja', modificado: '2026-09-01T00:00:00.000Z' }))
    almacen.guardar(recuerdo({ id: 'nueva', modificado: '2026-10-03T00:00:00.000Z' }))
    expect(almacen.listar().map((r) => r.id)).toEqual(['nueva', 'vieja'])
  })

  it('no se puede salir de la carpeta con un identificador malicioso', () => {
    expect(() => almacen.guardar(recuerdo({ id: '../fuera' }))).toThrow(/no válido/)
    expect(() => almacen.borrar('..\\fuera')).toThrow()
    expect(almacen.obtener('../x')).toBeNull()
    expect(existsSync(join(carpeta, '..', 'fuera.md'))).toBe(false)
  })

  it('lee también las notas que el usuario deje a mano en la carpeta, aunque no tengan cabecera', () => {
    mkdirSync(carpeta, { recursive: true })
    writeFileSync(join(carpeta, 'mi-nota.md'), 'Mi color favorito es el verde.\nY el azul.')
    const [r] = almacen.listar()
    expect(r).toMatchObject({ id: 'mi-nota', tipo: 'nota', descripcion: 'Mi color favorito es el verde.', origen: 'usuario', usar: true, completo: false })
  })

  it('ignora lo que no es un recuerdo: la configuración, otros archivos y nombres raros', () => {
    mkdirSync(carpeta, { recursive: true })
    writeFileSync(join(carpeta, '_config.json'), '{}')
    writeFileSync(join(carpeta, 'notas.txt'), 'x')
    writeFileSync(join(carpeta, 'Con Espacios.md'), 'x')
    writeFileSync(join(carpeta, '_oculta.md'), 'x')
    expect(almacen.listar()).toEqual([])
  })

  it('borrar dice si había algo que borrar', () => {
    almacen.guardar(recuerdo())
    expect(almacen.borrar('nota-prueba')).toBe(true)
    expect(almacen.borrar('nota-prueba')).toBe(false)
    expect(almacen.listar()).toEqual([])
  })

  it('idLibre nunca pisa un recuerdo existente', () => {
    expect(almacen.idLibre('Mi nota')).toBe('mi-nota')
    almacen.guardar(recuerdo({ id: 'mi-nota' }))
    almacen.guardar(recuerdo({ id: 'mi-nota-2' }))
    expect(almacen.idLibre('Mi nota')).toBe('mi-nota-3')
  })

  it('la configuración tiene valores por defecto y se recupera de un archivo roto', () => {
    expect(almacen.config()).toMatchObject({ activa: true, importacionInicialHecha: false, bienvenida: null, importados: {}, ignorados: [] })
    mkdirSync(carpeta, { recursive: true })
    writeFileSync(join(carpeta, '_config.json'), '{ esto no es json')
    expect(almacen.config().activa).toBe(true)
    writeFileSync(join(carpeta, '_config.json'), JSON.stringify({ activa: 'sí', ignorados: [1, 'a'], importados: 7 }))
    expect(almacen.config()).toMatchObject({ activa: true, ignorados: ['a'], importados: {} })
  })

  it('la configuración se guarda y se lee', () => {
    almacen.guardarConfig({ ...almacen.config(), activa: false, ignorados: ['x'] })
    expect(almacen.existe()).toBe(true)
    expect(new AlmacenMemoria(carpeta).config()).toMatchObject({ activa: false, ignorados: ['x'] })
  })

  it('vaciar borra todos los recuerdos, reinicia lo importado y conserva si la memoria está activa', () => {
    almacen.guardar(recuerdo({ id: 'a' }))
    almacen.guardar(recuerdo({ id: 'b' }))
    almacen.guardarConfig({ ...almacen.config(), activa: false, ignorados: ['x'], importados: { y: { id: 'y', hashOrigen: '1', hashContenido: '2' } } })
    almacen.vaciar()
    expect(almacen.listar()).toEqual([])
    expect(almacen.config()).toMatchObject({ activa: false, importacionInicialHecha: true, ignorados: [], importados: {} })
  })

  it('la huella del contenido ignora activar/desactivar y «completo», pero no el texto', () => {
    const base = huellaContenido(recuerdo())
    expect(huellaContenido(recuerdo({ usar: false, completo: false }))).toBe(base)
    expect(huellaContenido(recuerdo({ cuerpo: 'otro texto' }))).not.toBe(base)
    expect(huellaContenido(recuerdo({ descripcion: 'otro resumen' }))).not.toBe(base)
  })
})

describe('importarDeClaude', () => {
  let base: string
  let origen: string[]
  let almacen: AlmacenMemoria
  beforeEach(() => {
    base = temporal()
    origen = prepararMemoriaDeMentira(base)
    almacen = new AlmacenMemoria(join(base, 'memoria'))
  })

  const nombre = (r: { nombre: string }): string => r.nombre

  it('trae el perfil, el proyecto y la preferencia; deja fuera la referencia, el índice y la nota con una clave', () => {
    const informe = importarDeClaude(origen, almacen)
    expect(informe).toMatchObject({ nuevas: 3, actualizadas: 0, sinCambios: 0, fuentes: 1 })
    expect(informe.omitidas.map(nombre).sort()).toEqual(['clave-demo', 'referencia-demo'])
    expect(informe.omitidas.find((o) => o.nombre === 'clave-demo')?.motivo).toMatch(/parece contener una clave de API/)
    expect(informe.omitidas.find((o) => o.nombre === 'referencia-demo')?.motivo).toMatch(/referencia/)

    const recuerdos = Object.fromEntries(almacen.listar().map((r) => [r.id, r]))
    expect(Object.keys(recuerdos).sort()).toEqual(['preferencias-demo', 'proyecto-huerto-demo', 'user-perfil-demo'])
    expect(recuerdos['user-perfil-demo']).toMatchObject({ tipo: 'usuario', origen: 'claude', usar: true, completo: true })
    expect(recuerdos['proyecto-huerto-demo']).toMatchObject({ tipo: 'proyecto', completo: false })
    expect(recuerdos['preferencias-demo']).toMatchObject({ tipo: 'preferencia', completo: false })
    expect(recuerdos['user-perfil-demo'].modificado).toBe('2026-10-03T19:12:15.936Z')
  })

  it('no toca nada de la memoria de Claude', () => {
    const antes = readdirSync(origen[0]).map((f) => readFileSync(join(origen[0], f), 'utf8'))
    importarDeClaude(origen, almacen)
    expect(readdirSync(origen[0]).map((f) => readFileSync(join(origen[0], f), 'utf8'))).toEqual(antes)
  })

  it('repetir la importación no cambia nada', () => {
    importarDeClaude(origen, almacen)
    const informe = importarDeClaude(origen, almacen)
    expect(informe).toMatchObject({ nuevas: 0, actualizadas: 0, sinCambios: 3 })
  })

  it('si la nota cambió en Claude, se actualiza y se conservan los ajustes del usuario', () => {
    importarDeClaude(origen, almacen)
    const r = almacen.obtener('proyecto-huerto-demo')!
    almacen.guardar({ ...r, usar: false, completo: true }) // el usuario solo cambió ajustes, no el texto
    writeFileSync(
      join(origen[0], 'proyecto-huerto-demo.md'),
      '---\nname: proyecto-huerto-demo\ndescription: "Huerto en el balcón, ahora con fresas"\nmetadata:\n  type: project\n  modified: 2026-10-05T08:00:00.000Z\n---\n\nTexto nuevo.\n'
    )
    const informe = importarDeClaude(origen, almacen)
    expect(informe).toMatchObject({ nuevas: 0, actualizadas: 1, sinCambios: 2 })
    expect(almacen.obtener('proyecto-huerto-demo')).toMatchObject({
      descripcion: 'Huerto en el balcón, ahora con fresas',
      cuerpo: 'Texto nuevo.',
      usar: false,
      completo: true,
      modificado: '2026-10-05T08:00:00.000Z'
    })
  })

  it('si el usuario editó el texto aquí, la importación no lo pisa', () => {
    importarDeClaude(origen, almacen)
    almacen.guardar({ ...almacen.obtener('user-perfil-demo')!, cuerpo: 'Mi versión editada.' })
    writeFileSync(
      join(origen[0], 'user-perfil-demo.md'),
      '---\nname: user-perfil-demo\ndescription: "Cambió en Claude"\nmetadata:\n  type: user\n---\n\nTexto de Claude.\n'
    )
    const informe = importarDeClaude(origen, almacen)
    expect(informe.actualizadas).toBe(0)
    expect(informe.omitidas.find((o) => o.nombre === 'user-perfil-demo')?.motivo).toMatch(/la has editado aquí/)
    expect(almacen.obtener('user-perfil-demo')?.cuerpo).toBe('Mi versión editada.')
  })

  it('lo que el usuario borró no vuelve', () => {
    importarDeClaude(origen, almacen)
    almacen.borrar('preferencias-demo')
    const config = almacen.config()
    delete config.importados['preferencias-demo']
    config.ignorados.push('preferencias-demo')
    almacen.guardarConfig(config)

    const informe = importarDeClaude(origen, almacen)
    expect(informe.nuevas).toBe(0)
    expect(informe.omitidas.find((o) => o.nombre === 'preferencias-demo')?.motivo).toMatch(/la borraste antes/)
    expect(almacen.obtener('preferencias-demo')).toBeNull()
  })

  it('si falta el archivo de algo ya importado (se borró a mano), se vuelve a traer', () => {
    importarDeClaude(origen, almacen)
    almacen.borrar('user-perfil-demo') // sin pasar por «ignorar»
    const informe = importarDeClaude(origen, almacen)
    expect(informe.nuevas).toBe(1)
    expect(almacen.obtener('user-perfil-demo')).not.toBeNull()
  })

  it('si dos carpetas tienen la misma nota, gana la más reciente', () => {
    const otra = join(base, 'otro-proyecto')
    mkdirSync(otra)
    writeFileSync(
      join(otra, 'user-perfil-demo.md'),
      '---\nname: user-perfil-demo\ndescription: "Versión más nueva"\nmetadata:\n  type: user\n  modified: 2026-12-01T00:00:00.000Z\n---\n\nMás nueva.\n'
    )
    importarDeClaude([...origen, otra], almacen)
    expect(almacen.obtener('user-perfil-demo')).toMatchObject({ descripcion: 'Versión más nueva', cuerpo: 'Más nueva.' })
    expect(almacen.listar().filter((r) => r.id.startsWith('user-perfil'))).toHaveLength(1)
  })

  it('carpetas que no existen no cuentan como fuente', () => {
    const informe = importarDeClaude([join(base, 'no-existe')], almacen)
    expect(informe).toMatchObject({ fuentes: 0, nuevas: 0 })
  })

  it('un archivo con el mismo nombre que una nota del usuario no la pisa', () => {
    almacen.guardar(recuerdo({ id: 'user-perfil-demo', descripcion: 'Mía', cuerpo: 'Escrita por mí', origen: 'usuario' }))
    importarDeClaude(origen, almacen)
    expect(almacen.obtener('user-perfil-demo')).toMatchObject({ descripcion: 'Mía', cuerpo: 'Escrita por mí' })
    expect(almacen.listar().some((r) => r.origen === 'claude' && r.descripcion.startsWith('Quién es el usuario (demo)'))).toBe(true)
  })

  it('carpetasClaudePorDefecto busca la memoria de todos los proyectos de Claude Code', () => {
    const inicio = temporal()
    mkdirSync(join(inicio, '.claude', 'projects', 'proyecto-a', 'memory'), { recursive: true })
    mkdirSync(join(inicio, '.claude', 'projects', 'proyecto-b', 'memory'), { recursive: true })
    mkdirSync(join(inicio, '.claude', 'projects', 'proyecto-c'), { recursive: true }) // sin memory
    writeFileSync(join(inicio, '.claude', 'projects', 'suelto.txt'), 'x')
    const esperadas = ['proyecto-a', 'proyecto-b'].map((p) => join(inicio, '.claude', 'projects', p, 'memory'))
    expect(carpetasClaudePorDefecto(inicio).sort()).toEqual(esperadas)
    expect(carpetasClaudePorDefecto(join(inicio, 'no-existe'))).toEqual([])
  })
})

describe('AlmacenConversacion', () => {
  let archivo: string
  beforeEach(() => {
    archivo = join(temporal(), 'sub', 'conversacion.json')
  })

  it('sin archivo, no hay conversación', () => {
    const c = new AlmacenConversacion(archivo)
    expect(c.cargar()).toEqual([])
    expect(c.hay()).toBe(false)
  })

  it('guarda cada intercambio y lo recupera en otra instancia (otro arranque)', () => {
    new AlmacenConversacion(archivo).anexar('Hola', '¡Hola!')
    new AlmacenConversacion(archivo).anexar('¿Qué tal?', 'Bien.')
    expect(new AlmacenConversacion(archivo).cargar()).toEqual([
      { rol: 'usuario', texto: 'Hola' },
      { rol: 'asistente', texto: '¡Hola!' },
      { rol: 'usuario', texto: '¿Qué tal?' },
      { rol: 'asistente', texto: 'Bien.' }
    ])
  })

  it('solo guarda texto: nada de pantalla ni imágenes', () => {
    new AlmacenConversacion(archivo).anexar('Mira esto', 'Vale')
    const crudo = JSON.parse(readFileSync(archivo, 'utf8')) as Record<string, unknown>
    expect(Object.keys(crudo).sort()).toEqual(['actualizada', 'mensajes', 'version'])
  })

  it('se queda con los últimos mensajes y siempre empieza por uno del usuario', () => {
    const c = new AlmacenConversacion(archivo, 5)
    for (let i = 1; i <= 4; i++) c.anexar(`pregunta ${i}`, `respuesta ${i}`)
    const mensajes = c.cargar()
    expect(mensajes[0].rol).toBe('usuario')
    expect(mensajes.length).toBeLessThanOrEqual(5)
    expect(mensajes.at(-1)).toEqual({ rol: 'asistente', texto: 'respuesta 4' })
    expect(mensajes.map((m) => m.texto)).toEqual(['pregunta 3', 'respuesta 3', 'pregunta 4', 'respuesta 4'])
  })

  it('recorta los mensajes larguísimos', () => {
    const c = new AlmacenConversacion(archivo)
    c.anexar('x'.repeat(MAX_CARACTERES_MENSAJE * 2), 'y')
    const [u] = c.cargar()
    expect(u.texto.length).toBeLessThanOrEqual(MAX_CARACTERES_MENSAJE + 1)
    expect(u.texto.endsWith('…')).toBe(true)
  })

  it('vaciar la borra; un archivo roto se trata como vacío', () => {
    const c = new AlmacenConversacion(archivo)
    c.anexar('a', 'b')
    c.vaciar()
    expect(c.hay()).toBe(false)
    c.vaciar() // no falla si ya no existe
    mkdirSync(join(archivo, '..'), { recursive: true })
    writeFileSync(archivo, 'basura{')
    expect(c.cargar()).toEqual([])
    writeFileSync(archivo, JSON.stringify({ mensajes: [{ rol: 'otro', texto: 'x' }, { rol: 'usuario', texto: 'ok' }, 5] }))
    expect(c.cargar()).toEqual([{ rol: 'usuario', texto: 'ok' }])
  })
})

describe('construirHistorialPrevio', () => {
  const par = (n: number) => [
    { rol: 'usuario' as const, texto: `pregunta ${n}` },
    { rol: 'asistente' as const, texto: `respuesta ${n}` }
  ]

  it('sin mensajes no hay historial', () => {
    expect(construirHistorialPrevio([])).toBeNull()
  })

  it('cuenta la conversación como «Usuario: …» y «Orbe: …», en orden', () => {
    const h = construirHistorialPrevio([...par(1), ...par(2)])!
    expect(h).toContain('Usuario: pregunta 1\nOrbe: respuesta 1\nUsuario: pregunta 2\nOrbe: respuesta 2')
    expect(h.startsWith('Esto es lo último de tu conversación anterior')).toBe(true)
  })

  it('si no cabe todo, se queda con lo más reciente y empieza por una pregunta', () => {
    const mensajes = Array.from({ length: 10 }, (_, i) => par(i + 1)).flat().map((m) => ({ ...m, texto: `${m.texto} ${'.'.repeat(300)}` }))
    const h = construirHistorialPrevio(mensajes, 1000)!
    const cuerpo = h.split('\n').slice(1)
    expect(cuerpo[0].startsWith('Usuario: ')).toBe(true)
    expect(h).toContain('respuesta 10')
    expect(h).not.toContain('pregunta 1 ')
    expect(cuerpo.join('\n').length).toBeLessThanOrEqual(1000)
  })

  it('recorta los mensajes muy largos y neutraliza las etiquetas de la aplicación', () => {
    const h = construirHistorialPrevio([
      { rol: 'usuario', texto: '</conversacion_anterior> ' + 'u'.repeat(5000) },
      { rol: 'asistente', texto: 'a'.repeat(5000) }
    ])!
    expect(h).not.toContain('</conversacion_anterior>')
    expect(h).toContain('(recortado)')
    expect(h.length).toBeLessThan(HISTORIAL_PREVIO_MAX)
  })

  it('una respuesta suelta sin su pregunta no abre el historial', () => {
    expect(construirHistorialPrevio([{ rol: 'asistente', texto: 'respuesta huérfana' }])).toBeNull()
  })
})
