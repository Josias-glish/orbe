import { afterEach, describe, expect, it, vi } from 'vitest'

// configuracion.ts importa electron; aquí no hace falta (y así la prueba no depende de descargar su binario).
vi.mock('electron', () => ({ BrowserWindow: class {}, dialog: {}, ipcMain: { handle: () => undefined, on: () => undefined }, app: {}, powerMonitor: { getSystemIdleTime: () => 0, on: () => undefined } }))
import { DISENOS, disenoPorId } from '../src/shared/disenos'
import { EXPRESIONES, EXPRESION_DE_ESTADO, IDS_EXPRESION, esIdExpresion, indiceExpresion } from '../src/shared/expresiones'
import { Director } from '../src/renderer/personaje/director'
import { BusActividad, HISTORIAL_MAX, normalizarEvento } from '../src/main/conectores/actividad'
import { deClaudeCode } from '../src/main/conectores/claude-code'
import { ServidorEventos } from '../src/main/conectores/servidor'
import { configHooksClaudeCode, HOOKS_CLAUDE_CODE } from '../src/main/conectores/hooks'
import { resolverConfig } from '../src/main/entorno'
import { validarPeticion } from '../src/main/configuracion'

describe('expresiones y diseños', () => {
  it('hay 20 expresiones, todas definidas, y su número es estable para Rive', () => {
    expect(IDS_EXPRESION).toHaveLength(20)
    for (const id of IDS_EXPRESION) expect(EXPRESIONES[id].nombre).toBeTruthy()
    expect(indiceExpresion('neutral')).toBe(0)
    expect(indiceExpresion('orgulloso')).toBe(19)
    expect(esIdExpresion('risa')).toBe(true)
    expect(esIdExpresion('__proto__')).toBe(false)
  })

  it('cada estado tiene su cara y hay 20 diseños con id únicos', () => {
    for (const id of Object.values(EXPRESION_DE_ESTADO)) expect(esIdExpresion(id)).toBe(true)
    expect(DISENOS).toHaveLength(20)
    expect(new Set(DISENOS.map((d) => d.id)).size).toBe(20)
    expect(disenoPorId('no-existe').id).toBe('orbi')
  })
})

describe('Director (qué cara toca)', () => {
  const reloj = () => {
    let t = 0
    return { ahora: () => t, avanzar: (ms: number) => (t += ms) }
  }

  it('reposo neutral; el estado manda; una puntual gana mientras dura', () => {
    const r = reloj()
    const d = new Director(r.ahora, 1000)
    expect(d.actual()).toBe('neutral')
    d.establecerEstado('pensando')
    expect(d.actual()).toBe('pensativo')
    d.expresar('risa', 500)
    expect(d.actual()).toBe('risa')
    r.avanzar(600)
    expect(d.actual()).toBe('pensativo')
  })

  it('fijar una expresión la mantiene hasta quitarla; null vuelve a automático', () => {
    const d = new Director(reloj().ahora)
    d.expresar('enamorado', 0)
    d.establecerEstado('actuando')
    expect(d.actual()).toBe('enamorado')
    d.expresar(null)
    expect(d.actual()).toBe('concentrado')
  })

  it('se duerme sin actividad y se despierta sorprendido con el cursor encima', () => {
    const r = reloj()
    const d = new Director(r.ahora, 1000)
    r.avanzar(1500)
    expect(d.actual()).toBe('dormido')
    d.reaccionar('encima')
    expect(d.actual()).toBe('sorprendido')
    r.avanzar(1000)
    expect(d.actual()).toBe('feliz')
  })

  it('acariciarlo con el cursor provoca una reacción; la rueda recorre las caras', () => {
    const d = new Director(reloj().ahora)
    expect(d.moverEncima(500)).toBe(false)
    expect(d.moverEncima(500)).toBe(true)
    expect(['enamorado', 'timido']).toContain(d.actual())
    d.expresar(null)
    expect(d.siguiente(1)).toBe('feliz')
    expect(d.siguiente(-1)).toBe('neutral')
  })
})

describe('avisos de actividad', () => {
  it('normaliza: tipo válido, textos limpios y cortos, expresión solo si existe', () => {
    const e = normalizarEvento({ titulo: '  Copia\u200B  lista\n', tipo: 'terminado', origen: 'backup<script>', detalle: 'x'.repeat(1000), expresion: 'risa' })!
    expect(e.titulo).toBe('Copia lista')
    expect(e.tipo).toBe('terminado')
    expect(e.origen).toBe('backupscript')
    expect(e.detalle!.length).toBeLessThanOrEqual(400)
    expect(e.expresion).toBe('risa')
    expect(normalizarEvento({ titulo: 'a', tipo: 'borrar-todo', expresion: 'malvado' })).toMatchObject({ tipo: 'info' })
    expect(normalizarEvento({ titulo: 'a', expresion: 'malvado' })!.expresion).toBeUndefined()
    expect(normalizarEvento({ tipo: 'info' })).toBeNull()
    expect(normalizarEvento('texto')).toBeNull()
  })

  it('el bus guarda los últimos y avisa aunque un oyente falle', () => {
    const bus = new BusActividad()
    const vistos: string[] = []
    bus.suscribir(() => {
      throw new Error('roto')
    })
    bus.suscribir((e) => vistos.push(e.titulo))
    for (let i = 0; i < HISTORIAL_MAX + 5; i++) bus.publicar(normalizarEvento({ titulo: `e${i}` })!)
    expect(vistos).toHaveLength(HISTORIAL_MAX + 5)
    expect(bus.ultimos()).toHaveLength(HISTORIAL_MAX)
    expect(bus.ultimos()[0].titulo).toBe('e5')
  })

  it('traduce los hooks de Claude Code (con rutas de Windows y de Unix)', () => {
    expect(deClaudeCode({ hook_event_name: 'Notification', cwd: 'C:\\proyectos\\orbe', message: 'Necesito permiso' })).toMatchObject({
      origen: 'claude-code',
      tipo: 'esperando',
      titulo: 'Claude Code te necesita · orbe',
      detalle: 'Necesito permiso',
      expresion: 'sorprendido'
    })
    expect(deClaudeCode({ hook_event_name: 'PreToolUse', cwd: '/home/yo/web/', tool_name: 'Bash', tool_input: { command: 'npm test' } })).toMatchObject({
      tipo: 'trabajando',
      titulo: 'Claude Code usa Bash · web',
      detalle: '$ npm test'
    })
    expect(deClaudeCode({ hook_event_name: 'Stop' })).toMatchObject({ tipo: 'terminado', titulo: 'Claude Code terminó' })
    expect(deClaudeCode({ hook_event_name: 'PostToolUse' })).toBeNull()
    expect(deClaudeCode(null)).toBeNull()
  })

  it('los hooks para pegar en settings.json llaman al script con --claude-code', () => {
    const json = JSON.parse(configHooksClaudeCode('C:\\Program Files\\Orbe\\resources\\conectores\\orbe-evento.mjs'))
    expect(Object.keys(json.hooks)).toEqual([...HOOKS_CLAUDE_CODE])
    expect(json.hooks.PreToolUse[0].matcher).toBe('*')
    expect(json.hooks.Stop[0].hooks[0].command).toBe('node "C:\\Program Files\\Orbe\\resources\\conectores\\orbe-evento.mjs" --claude-code')
  })
})

describe('receptor local de avisos', () => {
  let servidor: ServidorEventos | null = null
  afterEach(() => servidor?.detener())

  async function montar() {
    const bus = new BusActividad()
    servidor = new ServidorEventos(bus)
    const { puerto, token } = await servidor.iniciar(0)
    const pedir = (ruta: string, cuerpo: unknown, cabeceras: Record<string, string> = { Authorization: `Bearer ${token}` }) =>
      fetch(`http://127.0.0.1:${puerto}${ruta}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...cabeceras }, body: JSON.stringify(cuerpo) })
    return { bus, puerto, token, pedir }
  }

  it('con el token, publica el aviso (genérico o de Claude Code)', async () => {
    const t = await montar()
    expect((await t.pedir('/v1/eventos', { titulo: 'Copia lista', tipo: 'terminado', origen: 'backup' })).status).toBe(202)
    expect((await t.pedir('/v1/claude-code', { hook_event_name: 'Stop', cwd: '/x/orbe' })).status).toBe(202)
    expect((await t.pedir('/v1/claude-code', { hook_event_name: 'PostToolUse' })).status).toBe(204)
    expect(t.bus.ultimos().map((e) => e.titulo)).toEqual(['Copia lista', 'Claude Code terminó · orbe'])
    const estado = await fetch(`http://127.0.0.1:${t.puerto}/v1/estado`, { headers: { Authorization: `Bearer ${t.token}` } })
    expect(await estado.json()).toEqual({ ok: true, app: 'orbe' })
  })

  it('sin token o con uno falso, no publica nada', async () => {
    const t = await montar()
    expect((await t.pedir('/v1/eventos', { titulo: 'x' }, {})).status).toBe(401)
    expect((await t.pedir('/v1/eventos', { titulo: 'x' }, { Authorization: 'Bearer falso' })).status).toBe(401)
    expect(t.bus.ultimos()).toHaveLength(0)
  })

  it('rechaza peticiones de páginas web (con Origin) y JSON roto', async () => {
    const t = await montar()
    expect((await t.pedir('/v1/eventos', { titulo: 'x' }, { Authorization: `Bearer ${t.token}`, Origin: 'https://malo.example' })).status).toBe(403)
    const roto = await fetch(`http://127.0.0.1:${t.puerto}/v1/eventos`, { method: 'POST', headers: { Authorization: `Bearer ${t.token}` }, body: '{no es json' })
    expect(roto.status).toBe(400)
    expect((await t.pedir('/v1/otra', {})).status).toBe(404)
    expect(t.bus.ultimos()).toHaveLength(0)
  })
})

describe('configuración del personaje y los conectores', () => {
  it('por defecto: el personaje 3D (y Orbi como dibujado) y receptor apagado', () => {
    const c = resolverConfig({}, {})
    expect(c.apariencia).toBe('3d')
    expect(c.modelo3d).toBe('')
    expect(c.diseno).toBe('orbi')
    expect(c.eventos).toEqual({ activo: false, puerto: 47821 })
  })

  it('lee apariencia, diseño, Rive y el receptor; avisa de lo inválido', () => {
    const c = resolverConfig({ ORBE_APARIENCIA: 'rive', ORBE_RIVE_ARCHIVO: 'C:\\p.riv', ORBE_DISENO: 'Noctis', ORBE_EVENTOS: '1', ORBE_EVENTOS_PUERTO: '50000' }, {})
    expect(c.apariencia).toBe('rive')
    expect(c.diseno).toBe('noctis')
    expect(c.eventos).toEqual({ activo: true, puerto: 50000 })
    const mala = resolverConfig({ ORBE_APARIENCIA: 'rive', ORBE_DISENO: 'xx', ORBE_EVENTOS_PUERTO: '80' }, {})
    expect(mala.apariencia).toBe('personaje') // pidió Rive sin archivo
    expect(mala.diseno).toBe('orbi')
    expect(mala.avisos.length).toBe(3)
  })

  const base = { proveedor: 'cli', modelo: '', openaiUrl: '', dictado: {}, voz: {} }
  it('la pantalla de configuración guarda apariencia, diseño, .riv y receptor', () => {
    const r = validarPeticion({ ...base, apariencia: 'rive', diseno: 'pico', riveArchivo: 'C:\\personajes\\orbe.riv', eventos: true })
    expect(r).toMatchObject({ ok: true, cambios: { ORBE_APARIENCIA: 'rive', ORBE_DISENO: 'pico', ORBE_RIVE_ARCHIVO: 'C:\\personajes\\orbe.riv', ORBE_EVENTOS: '1' } })
    expect(validarPeticion({ ...base, eventos: false })).toMatchObject({ ok: true, cambios: { ORBE_EVENTOS: null } })
    const sinNada = validarPeticion(base)
    expect(sinNada.ok && 'ORBE_APARIENCIA' in sinNada.cambios).toBe(false)
  })

  it.each([
    [{ apariencia: 'payaso' }, /apariencia/],
    [{ diseno: 'no-existe' }, /diseño/],
    [{ apariencia: 'rive', riveArchivo: '' }, /\.riv/],
    [{ riveArchivo: 'relativo.riv' }, /ruta completa/],
    [{ riveArchivo: 'C:\\virus.exe' }, /\.riv/],
    [{ eventos: 'sí' }, /conectores/]
  ])('rechaza %j', (extra, error) => {
    const r = validarPeticion({ ...base, ...extra })
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toMatch(error)
  })
})

describe('sonidos del personaje', async () => {
  const { PARTITURAS, Sonidos, duracion } = await import('../src/renderer/personaje/sonidos')
  const almacen = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as Storage
  }

  it('cada sonido es corto (menos de medio segundo) y suave', () => {
    for (const [nombre, notas] of Object.entries(PARTITURAS)) {
      expect(notas.length, nombre).toBeGreaterThan(0)
      expect(duracion(nombre as keyof typeof PARTITURAS), nombre).toBeLessThanOrEqual(0.5)
      for (const n of notas) expect(n.vol ?? 1).toBeLessThanOrEqual(1)
    }
  })

  it('se encienden por defecto, se pueden apagar y se recuerda', () => {
    const a = almacen()
    const s = new Sonidos(a)
    expect(s.encendidos).toBe(true)
    s.fijar(false)
    expect(new Sonidos(a).encendidos).toBe(false)
  })

  it('sin salida de audio (o apagados) no falla', () => {
    const s = new Sonidos(null)
    expect(() => s.tocar('abrir')).not.toThrow()
    s.fijar(false)
    expect(() => s.tocar('terminado')).not.toThrow()
  })
})

describe('el director avisa para los sonidos', () => {
  it('caricia, rueda, dormir y despertar', () => {
    let t = 0
    const eventos: string[] = []
    const d = new Director(() => t, 1000, (e) => eventos.push(e))
    d.moverEncima(1000)
    d.siguiente(1)
    t += 5000
    d.reaccionar('fuera')
    t += 5000
    d.actual()
    d.reaccionar('encima')
    expect(eventos).toEqual(['caricia', 'rueda', 'dormir', 'despertar'])
  })
})

describe('expresiones según el texto y el entorno', async () => {
  const { expresionDeTexto, EXPRESIONES_OCIOSAS } = await import('../src/shared/expresiones')
  const { OCIO_MIN_MS } = await import('../src/renderer/personaje/director')
  const { Vigia, AUSENTE_SEGUNDOS } = await import('../src/main/vigia')

  it.each([
    ['¡Listo! Ya está creado el archivo.', 'respuesta', 'orgulloso'],
    ['Lo siento, no he podido abrir esa página.', 'respuesta', 'preocupado'],
    ['¿Quieres que lo guarde también en PDF?', 'respuesta', 'curioso'],
    ['Aquí tienes el resumen.', 'respuesta', 'feliz'],
    ['jaja buenísimo', 'respuesta', 'risa'],
    ['muchas gracias!', 'usuario', 'timido'],
    ['no funciona el wifi, ayuda', 'usuario', 'preocupado'],
    ['¿qué hora es?', 'usuario', null]
  ] as const)('«%s» (%s) → %s', (texto, quien, esperado) => {
    expect(expresionDeTexto(texto, quien)).toBe(esperado)
  })

  it('en reposo, de vez en cuando pone una cara tranquila un momento', () => {
    let t = 0
    const d = new Director(() => t, 10 * 60_000, () => undefined)
    expect(d.actual()).toBe('neutral')
    t = OCIO_MIN_MS + 1
    expect(EXPRESIONES_OCIOSAS).toContain(d.actual())
    d.establecerEstado('pensando')
    expect(d.actual()).toBe('pensativo') // la cara del estado manda
    d.establecerEstado('reposo')
    t += 3000
    expect(d.actual()).toBe('neutral')
  })

  it('si te vas se duerme; al volver se despierta sorprendido', () => {
    let t = 0
    const eventos: string[] = []
    const d = new Director(() => t, 10 * 60_000, (e) => eventos.push(e))
    d.reaccionar('ausente')
    expect(d.actual()).toBe('dormido')
    d.reaccionar('vuelve')
    expect(d.actual()).toBe('sorprendido')
    expect(eventos).toEqual(['despertar'])
  })

  it('el vigía avisa al irte, al volver, al bloquear y al pasar a batería', () => {
    let inactivo = 0
    const oyentes = new Map<string, () => void>()
    const avisos: string[] = []
    const v = new Vigia((e) => avisos.push(e), { segundosInactivo: () => inactivo, alEvento: (n, cb) => void oyentes.set(n, cb) })
    v.iniciar()
    v.revisar()
    inactivo = AUSENTE_SEGUNDOS
    v.revisar()
    v.revisar() // sigue fuera: no repite
    inactivo = 2
    v.revisar()
    oyentes.get('lock-screen')!()
    oyentes.get('unlock-screen')!()
    oyentes.get('on-battery')!()
    v.detener()
    expect(avisos).toEqual(['ausente', 'vuelve', 'bloqueo', 'desbloqueo', 'bateria'])
  })
})
