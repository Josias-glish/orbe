import { mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AlmacenContenido, limpiarCambios, medidasPng, problemaPng } from '../src/main/contenido/almacen'
import { crearHerramientasContenido } from '../src/main/agente/herramientas/contenido'
import { Disenador, extraerFondo, extraerHtml, HERRAMIENTAS_DISENADOR, MARCA_FONDO } from '../src/main/contenido/disenador'

/** Un PNG mínimo: firma + cabecera IHDR con las medidas pedidas (basta para validar medidas y peso). */
function png(ancho: number, alto: number): Buffer {
  const b = Buffer.alloc(33)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(ancho, 16)
  b.writeUInt32BE(alto, 20)
  return b
}

/** Escribe un archivo en la entrada con fecha antigua (ya «quieto»). */
function exportar(carpeta: string, nombre: string, datos: Buffer | string): void {
  const ruta = join(carpeta, nombre)
  writeFileSync(ruta, datos)
  utimesSync(ruta, new Date(0), new Date(0))
}

const nuevo = (deps = {}): AlmacenContenido => new AlmacenContenido(mkdtempSync(join(tmpdir(), 'orbe-contenido-')), deps)
const datos = { marca: 'morfy' as const, idea: 'Lanzamiento', texto: 'Ya está aquí', pie: 'Nuevo', hashtags: ['#morfy'] }

describe('PNG', () => {
  it('lee medidas y rechaza lo que Instagram no acepta', () => {
    expect(medidasPng(png(1080, 1350))).toEqual({ ancho: 1080, alto: 1350 })
    expect(medidasPng(Buffer.from('hola'))).toBeNull()
    expect(problemaPng(png(1080, 1920))).toBeNull()
    expect(problemaPng(png(1000, 1000))).toMatch(/mide 1000×1000/)
    expect(problemaPng(Buffer.concat([png(1080, 1080), Buffer.alloc(8 * 1024 * 1024)]))).toMatch(/máximo 8 MB/)
  })
})

describe('AlmacenContenido', () => {
  it('crea las fichas y carpetas de entrada de las tres marcas', () => {
    const a = nuevo()
    for (const m of ['jsdesign', 'morfy', 'personal'] as const) {
      expect(existsSync(a.entrada(m))).toBe(true)
      expect(a.ficha(m)).toContain('Tono de voz')
    }
  })

  it('une los PNG a su pieza por el nombre (carrusel en orden) y guarda en disco', async () => {
    const a = nuevo()
    const p = a.proponer(datos)
    exportar(a.entrada('morfy'), `${p.id}-2.png`, png(1080, 1350))
    exportar(a.entrada('morfy'), `${p.id}-1.png`, png(1080, 1350))
    expect(await a.recoger()).toBe(true)
    expect(a.lista()[0].archivos).toEqual([`${p.id}-1.png`, `${p.id}-2.png`])
    expect(readdirSync(a.entrada('morfy'))).toEqual([])
    const otra = new AlmacenContenido(a.raiz)
    expect(otra.lista()[0].archivos).toHaveLength(2)
  })

  it('un PNG con otro nombre crea una pieza nueva; uno que no vale se queda y avisa', async () => {
    const a = nuevo()
    exportar(a.entrada('personal'), 'reflexion.png', png(1080, 1080))
    exportar(a.entrada('personal'), 'mal.png', png(800, 600))
    await a.recoger()
    expect(a.lista()).toHaveLength(1)
    expect(a.lista()[0].marca).toBe('personal')
    expect(a.avisos).toEqual(['personal/mal.png: mide 800×600; se espera 1080×1350, 1080×1080 o 1080×1920.'])
    expect(readdirSync(a.entrada('personal'))).toEqual(['mal.png'])
  })

  it('no toca un archivo que aún se está escribiendo', async () => {
    const a = nuevo()
    writeFileSync(join(a.entrada('morfy'), 'nuevo.png'), png(1080, 1350))
    expect(await a.recoger()).toBe(false)
  })

  it('un HTML pasa por el render y se trata como PNG', async () => {
    let recibido = ''
    const a = nuevo({ renderizar: async (html: string) => ((recibido = html), png(1080, 1350)) })
    exportar(a.entrada('jsdesign'), 'post.html', '<h1>Hola</h1>')
    await a.recoger()
    expect(recibido).toBe('<h1>Hola</h1>')
    expect(a.lista()[0].archivos).toHaveLength(1)
  })

  it('aprobar exige imagen, y editar o añadir imagen quita la aprobación', async () => {
    const a = nuevo()
    const p = a.proponer(datos)
    expect(() => a.aprobar(p.id, true)).toThrow(/Falta la imagen/)
    exportar(a.entrada('morfy'), `${p.id}.png`, png(1080, 1350))
    await a.recoger()
    expect(a.aprobar(p.id, true).aprobada).toBe(true)
    expect(a.actualizar(p.id, { pie: 'Otro' }).aprobada).toBe(false)
  })

  it('borrar mueve las imágenes a la papelera en vez de eliminarlas', async () => {
    const a = nuevo()
    const p = a.proponer(datos)
    exportar(a.entrada('morfy'), `${p.id}.png`, png(1080, 1350))
    await a.recoger()
    a.borrar(p.id)
    expect(a.lista()).toHaveLength(0)
    const papelera = readdirSync(join(a.raiz, 'papelera'))
    expect(papelera).toHaveLength(1)
    expect(readdirSync(join(a.raiz, 'papelera', papelera[0]))).toContain(`${p.id}-1.png`)
  })

  it('el encargo nombra el archivo y la carpeta donde exportar', () => {
    const a = nuevo()
    const p = a.proponer(datos)
    expect(a.encargo(p.id)).toContain(`${p.id}.png`)
    expect(a.encargo(p.id)).toContain(a.entrada('morfy'))
  })
})

describe('herramientas de contenido', () => {
  it('contenido_proponer guarda la pieza, filtra hashtags y avisa a la interfaz', async () => {
    const a = nuevo()
    const propuestas: string[] = []
    const [ficha, proponer] = crearHerramientasContenido(a, (id) => propuestas.push(id))
    const v = proponer.validar({ marca: 'morfy', idea: 'Idea', texto: 'Titular', pie: 'Pie', hashtags: '#uno nada #dos' })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    await proponer.ejecutar(v.valor, {} as never)
    expect(a.lista()[0].hashtags).toEqual(['#uno', '#dos'])
    expect(propuestas).toEqual([a.lista()[0].id])
    expect(proponer.validar({ marca: 'otra', idea: 'x', texto: 'x', pie: 'x' }).ok).toBe(false)
    const f = ficha.validar({ marca: 'personal' })
    if (f.ok) expect((await ficha.ejecutar(f.valor, {} as never)).texto).toContain('tu marca personal')
    expect(JSON.parse(readFileSync(join(a.raiz, 'contenido.json'), 'utf8'))).toHaveLength(1)
  })

  it('limpiarCambios solo deja los campos de texto conocidos', () => {
    expect(limpiarCambios({ pie: 'a', aprobada: true, archivos: ['x'], hashtags: ['#a', 3] })).toEqual({ pie: 'a', hashtags: ['#a'] })
  })
})

describe('Disenador', () => {
  it('extrae los documentos HTML de la respuesta, en orden', () => {
    expect(extraerHtml('Aquí van:\n<!doctype html><html><body>1</body></html>\n<html lang="es"><body>2</body></html> fin')).toEqual([
      '<!doctype html><html><body>1</body></html>',
      '<html lang="es"><body>2</body></html>'
    ])
  })

  it('diseña la pieza sola: pasa la idea al CLI, renderiza cada HTML y pone las imágenes', async () => {
    const a = nuevo()
    const p = a.proponer(datos)
    let prompt = ''
    let carpeta = ''
    const d = new Disenador(a, async (pr, c) => ((prompt = pr), (carpeta = c), '<html>1</html><html>2</html>'), async () => png(1080, 1350), () => undefined)
    await d.disenar(p.id)
    expect(prompt).toContain('Idea: Lanzamiento')
    expect(carpeta).toBe(a.carpetaMarca('morfy'))
    expect(a.lista()[0].archivos).toEqual([`${p.id}-1.png`, `${p.id}-2.png`])
    expect(d.enCurso.size).toBe(0)
  })

  it('si el CLI falla o el render no vale, anota el error y no toca la pieza', async () => {
    const a = nuevo()
    const p = a.proponer(datos)
    const falla = new Disenador(a, async () => { throw new Error('sin sesión') }, async () => png(1080, 1350), () => undefined)
    await falla.disenar(p.id)
    expect(falla.errores.get(p.id)).toBe('sin sesión')
    const torcido = new Disenador(a, async () => '<html></html>', async () => png(500, 500), () => undefined)
    await torcido.disenar(p.id)
    expect(torcido.errores.get(p.id)).toMatch(/mide 500×500/)
    expect(a.lista()[0].archivos).toEqual([])
  })
})

describe('Disenador con foto de Higgsfield', () => {
  it('pide la foto al conector, la descarga, la pone en el HTML y la borra tras el render', async () => {
    const a = nuevo()
    const p = a.proponer({ ...datos, imagen: 'sunset over a studio' })
    let pedido = ''
    let html = ''
    let existiaAlRender = false
    const descargadas: string[] = []
    const d = new Disenador(
      a,
      async (pr) => ((pedido = pr), `FONDO_URL: https://cdn.higgsfield.ai/x.jpg\n<html><body style="background:url(${MARCA_FONDO})"></body></html>`),
      async (h, carpeta) => {
        html = h
        existiaAlRender = existsSync(join(carpeta, /url\(([^)]+)\)/.exec(h)?.[1] ?? ''))
        return png(1080, 1350)
      },
      () => undefined,
      async (url) => (descargadas.push(url), { datos: Buffer.from('JPG'), mime: 'image/jpeg' })
    )
    await d.disenar(p.id)
    expect(pedido).toContain('generate_image_batch')
    expect(pedido).toContain('sunset over a studio')
    expect(descargadas).toEqual(['https://cdn.higgsfield.ai/x.jpg'])
    expect(html).toContain(`.fondo-${p.id}.jpg`)
    expect(existiaAlRender).toBe(true)
    expect(existsSync(join(a.carpetaMarca('morfy'), `.fondo-${p.id}.jpg`))).toBe(false)
    expect(a.lista()[0].archivos).toHaveLength(1)
  })

  it('sin descripción visual no pide foto; extraerFondo solo acepta https', () => {
    expect(extraerFondo('FONDO_URL: http://x.com/a.jpg')).toBeNull()
    expect(extraerFondo('hola\nFONDO_URL: https://x.com/a.jpg\n<html></html>')).toBe('https://x.com/a.jpg')
    expect(HERRAMIENTAS_DISENADOR.filter((h) => h.startsWith('mcp__'))).toEqual(['mcp__claude_ai_Higgsfield__generate_image_batch', 'mcp__claude_ai_Higgsfield__jobs_wait'])
  })
})
