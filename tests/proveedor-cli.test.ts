import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ErrorChat } from '../src/main/chat/errores'
import type { ManejadoresTurno } from '../src/main/chat/proveedor'
import { ProveedorCli, argumentosCli, buscarRutaCli, type OpcionesProveedorCli } from '../src/main/chat/proveedor-cli'
import { PROMPT_SISTEMA } from '../src/main/chat/prompt-sistema'

const aqui = dirname(fileURLToPath(import.meta.url))
const FALSO = join(aqui, 'falso-claude.mjs')

interface Lanzamiento {
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  hijo: ChildProcess
}

let lanzamientos: Lanzamiento[]
let proveedores: ProveedorCli[]

function crear(extra: Partial<OpcionesProveedorCli> = {}): ProveedorCli {
  const p = new ProveedorCli({
    modelo: 'claude-sonnet-5-5',
    esfuerzo: 'medium',
    directorioTrabajo: mkdtempSync(join(tmpdir(), 'orbe-cli-')),
    esperaInterrupcionMs: 300,
    lanzador: (args, { cwd, env }) => {
      const hijo = spawn(process.execPath, [FALSO, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      lanzamientos.push({ args, cwd, env, hijo })
      return hijo
    },
    ...extra
  })
  proveedores.push(p)
  return p
}

function recolector(): ManejadoresTurno & { textos: string[]; reintentos: Array<[number, number]>; avisos: string[]; texto(): string } {
  const textos: string[] = []
  const reintentos: Array<[number, number]> = []
  const avisos: string[] = []
  return {
    textos,
    reintentos,
    avisos,
    texto: () => textos.join(''),
    alTexto: (d) => textos.push(d),
    alReintento: (i, m) => reintentos.push([i, m]),
    alAviso: (t) => avisos.push(t)
  }
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

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Espera a que se cumpla algo, en vez de a que pase un tiempo fijo: arrancar el CLI de mentira tarda lo que tarde la máquina. */
async function esperarHasta(condicion: () => boolean, maximoMs = 5000): Promise<void> {
  const limite = Date.now() + maximoMs
  while (!condicion() && Date.now() < limite) await esperar(10)
}

beforeEach(() => {
  lanzamientos = []
  proveedores = []
})
afterEach(() => {
  for (const p of proveedores) p.cerrar()
})

describe('argumentosCli', () => {
  it('pide un chat puro: sin herramientas, sin ajustes del usuario, sin persistencia y con nuestro prompt', () => {
    const args = argumentosCli('claude-sonnet-5-5', 'low')
    const valorDe = (bandera: string): string => args[args.indexOf(bandera) + 1]
    expect(args).toContain('-p')
    expect(valorDe('--input-format')).toBe('stream-json')
    expect(valorDe('--output-format')).toBe('stream-json')
    expect(args).toContain('--include-partial-messages')
    expect(valorDe('--model')).toBe('claude-sonnet-5-5')
    expect(valorDe('--effort')).toBe('low')
    expect(valorDe('--tools')).toBe('')
    expect(valorDe('--setting-sources')).toBe('')
    expect(valorDe('--system-prompt')).toBe(PROMPT_SISTEMA)
    expect(args).toContain('--strict-mcp-config')
    expect(args).toContain('--no-session-persistence')
    expect(args).toContain('--disable-slash-commands')
    expect(args).not.toContain('--bare')
  })
})

describe('argumentosCli con memoria', () => {
  it('usa el prompt que se le pasa (las instrucciones, la fecha y la memoria)', () => {
    const prompt = `${PROMPT_SISTEMA}\n\nFecha\n- Hoy es lunes 5 de octubre de 2026.\n\nMemoria del usuario\n- [Perfil] Estudiante`
    const args = argumentosCli('claude-sonnet-5-5', 'low', prompt)
    expect(args[args.indexOf('--system-prompt') + 1]).toBe(prompt)
  })
})

describe('buscarRutaCli', () => {
  const existe = (...rutas: string[]) => (r: string) => rutas.includes(r)
  const exe = join('C:\\npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')

  it('usa el .exe real que hay junto al shim de npm', () => {
    expect(buscarRutaCli(['C:\\npm\\claude', 'C:\\npm\\claude.cmd'], existe(exe))).toBe(exe)
  })

  it('acepta directamente un .exe que aparezca en la salida de where', () => {
    expect(buscarRutaCli(['D:\\bin\\claude.exe'], existe('D:\\bin\\claude.exe'))).toBe('D:\\bin\\claude.exe')
  })

  it('prueba la instalación nativa en el perfil del usuario', () => {
    const nativa = join('C:\\Users\\yo', '.local', 'bin', 'claude.exe')
    expect(buscarRutaCli([], existe(nativa), { USERPROFILE: 'C:\\Users\\yo' })).toBe(nativa)
  })

  it('devuelve null si no encuentra nada', () => {
    expect(buscarRutaCli(['C:\\npm\\claude.cmd'], existe(), {})).toBeNull()
  })
})

describe('ProveedorCli: memoria del usuario', () => {
  const promptDe = (i: number): string => {
    const args = lanzamientos[i].args
    return args[args.indexOf('--system-prompt') + 1]
  }

  it('el prompt del proceso lleva las instrucciones, la fecha y la memoria', async () => {
    const p = crear({ memoria: () => 'Memoria del usuario\n- [Perfil] Le gusta la astronomía', ahora: () => new Date(2026, 9, 4, 10) })
    await p.enviar({ texto: 'hola' }, recolector())
    expect(promptDe(0).startsWith(PROMPT_SISTEMA)).toBe(true)
    expect(promptDe(0)).toContain('Hoy es domingo 4 de octubre de 2026.')
    expect(promptDe(0)).toContain('- [Perfil] Le gusta la astronomía')
  })

  it('sin memoria, el prompt solo lleva las instrucciones y la fecha', async () => {
    const p = crear({ memoria: () => undefined })
    await p.enviar({ texto: 'hola' }, recolector())
    expect(promptDe(0)).not.toContain('Memoria del usuario\n')
  })

  it('la memoria se fija al lanzar el proceso: cambia con la conversación nueva, no a mitad de la actual', async () => {
    let memoria = 'NOTAS V1'
    const p = crear({ memoria: () => memoria })
    await p.enviar({ texto: 'uno' }, recolector())
    memoria = 'NOTAS V2'
    await p.enviar({ texto: 'dos' }, recolector())
    expect(lanzamientos).toHaveLength(1)
    expect(promptDe(0)).toContain('NOTAS V1')

    p.reiniciar()
    await p.enviar({ texto: 'tres' }, recolector())
    expect(lanzamientos).toHaveLength(2)
    expect(promptDe(1)).toContain('NOTAS V2')
  })
})

describe('ProveedorCli', () => {
  it('emite el texto en streaming y mantiene un único proceso con memoria entre turnos', async () => {
    const p = crear()
    const m1 = recolector()
    const r1 = await p.enviar({ texto: 'primero' }, m1)
    expect(r1.motivo).toBe('completo')
    expect(m1.textos.length).toBeGreaterThan(3) // llegó en varios fragmentos
    expect(m1.texto()).toContain('Turno 1 (1 mensajes en memoria): primero')

    const m2 = recolector()
    await p.enviar({ texto: 'segundo' }, m2)
    expect(m2.texto()).toContain('Turno 2 (2 mensajes en memoria): segundo')
    expect(lanzamientos).toHaveLength(1)
  })

  it('lanza el CLI con los argumentos esperados, en la carpeta indicada y sin claves de API', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-no-debe-pasar'
    process.env['ANTHROPIC_AUTH_TOKEN'] = 'token-no-debe-pasar'
    try {
      const p = crear({ modelo: 'claude-opus-5-5', esfuerzo: 'high' })
      await p.enviar({ texto: 'hola' }, recolector())
      const l = lanzamientos[0]
      expect(l.args.slice(l.args.indexOf('--model'), l.args.indexOf('--model') + 2)).toEqual(['--model', 'claude-opus-5-5'])
      expect(l.args).toContain('high')
      expect(l.env['ANTHROPIC_API_KEY']).toBeUndefined()
      expect(l.env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined()
      expect(l.cwd).toContain('orbe-cli-')
    } finally {
      delete process.env['ANTHROPIC_API_KEY']
      delete process.env['ANTHROPIC_AUTH_TOKEN']
    }
  })

  it('envía las imágenes como bloques base64', async () => {
    const p = crear()
    const m = recolector()
    await p.enviar(
      { texto: 'mira', contexto: { imagen: { tipoMime: 'image/jpeg', base64: 'AAAA', ancho: 10, alto: 10 } } },
      m
    )
    expect(m.texto()).toContain('con imagen')
  })

  it('los bloques de razonamiento no se mezclan con la respuesta', async () => {
    const p = crear()
    const m = recolector()
    await p.enviar({ texto: 'PENSAR' }, m)
    expect(m.texto()).toBe('Listo.')
  })

  it('si no llegan fragmentos, usa el mensaje completo como respaldo', async () => {
    const p = crear()
    const m = recolector()
    await p.enviar({ texto: 'SOLO_MENSAJE' }, m)
    expect(m.texto()).toBe('Respuesta sin deltas')
  })

  it('distingue una respuesta cortada por longitud', async () => {
    const p = crear()
    const r = await p.enviar({ texto: 'TRUNCADO' }, recolector())
    expect(r.motivo).toBe('limite_tokens')
  })

  it('un rechazo de seguridad es un error «rechazo»', async () => {
    const p = crear()
    const e = await errorDe(p.enviar({ texto: 'REFUSAL' }, recolector()))
    expect(e.error.codigo).toBe('rechazo')
  })

  it('sin sesión iniciada: error claro, sin aviso de contexto perdido, y se puede reintentar', async () => {
    const p = crear()
    const m = recolector()
    const e = await errorDe(p.enviar({ texto: 'ERR_AUTH' }, m))
    expect(e.error.codigo).toBe('sin_sesion')
    expect(e.error.mensaje).toContain('/login')
    expect(m.texto()).toBe('') // el texto del error no se cuela como respuesta

    await esperar(150) // el CLI sale tras el fallo
    const m2 = recolector()
    const r = await p.enviar({ texto: 'ya he iniciado sesión' }, m2)
    expect(r.motivo).toBe('completo')
    expect(lanzamientos).toHaveLength(2)
    expect(m2.avisos).toEqual([])
  })

  it('límite de uso: error con la hora de reinicio', async () => {
    const p = crear()
    const e = await errorDe(p.enviar({ texto: 'ERR_LIMITE' }, recolector()))
    expect(e.error.codigo).toBe('limite_uso')
    expect(e.error.mensaje).toContain('Se restablece')
  })

  it('sin conexión: avisa de los reintentos y se rinde tras tres, en lugar de esperar minutos', async () => {
    const p = crear()
    const m = recolector()
    const inicio = Date.now()
    const e = await errorDe(p.enviar({ texto: 'SIN_RED' }, m))
    expect(e.error.codigo).toBe('sin_conexion')
    expect(m.reintentos).toEqual([[1, 3], [2, 3], [3, 3]])
    expect(Date.now() - inicio).toBeLessThan(3000)
    // El proceso sigue vivo y utilizable.
    const r = await p.enviar({ texto: 'ya hay red' }, recolector())
    expect(r.motivo).toBe('completo')
    expect(lanzamientos).toHaveLength(1)
  })

  it('servidores saturados (529) se traducen a saturación tras los reintentos', async () => {
    const p = crear()
    const e = await errorDe(p.enviar({ texto: 'SATURADO' }, recolector()))
    expect(e.error.codigo).toBe('sobrecarga')
  })

  it('cancelar detiene la respuesta, conserva el proceso y deja seguir la conversación', async () => {
    const p = crear()
    const m = recolector()
    const envio = p.enviar({ texto: 'LARGO' }, m)
    await esperarHasta(() => m.textos.length > 0)
    expect(m.textos.length).toBeGreaterThan(0)
    p.cancelar()
    const r = await envio
    expect(r.motivo).toBe('cancelado')

    const m2 = recolector()
    const siguiente = await p.enviar({ texto: 'seguimos' }, m2)
    expect(siguiente.motivo).toBe('completo')
    expect(lanzamientos).toHaveLength(1)
  })

  it('si el CLI no confirma la interrupción, se mata y la siguiente conversación avisa de que se perdió el contexto', async () => {
    const p = crear({ esperaInterrupcionMs: 150 })
    await p.enviar({ texto: 'algo previo' }, recolector()) // ya hay contexto que perder
    const envio = p.enviar({ texto: 'CUELGA' }, recolector())
    await esperar(80)
    p.cancelar()
    expect((await envio).motivo).toBe('cancelado')

    const m = recolector()
    await p.enviar({ texto: 'otra vez' }, m)
    expect(lanzamientos).toHaveLength(2)
    expect(m.avisos).toHaveLength(1)
    expect(m.avisos[0]).toContain('olvidado')
  })

  it('silencio total del CLI: error de tiempo agotado', async () => {
    const p = crear({ silencioMaxMs: 200, esperaInterrupcionMs: 100 })
    const e = await errorDe(p.enviar({ texto: 'CUELGA' }, recolector()))
    expect(e.error.codigo).toBe('tiempo_agotado')
  })

  it('un cierre inesperado del CLI se explica con su salida de error', async () => {
    const p = crear()
    const e = await errorDe(p.enviar({ texto: 'CRASH' }, recolector()))
    expect(e.error.codigo).toBe('desconocido')
    expect(e.error.detalle).toContain('boom')
    expect(e.error.detalle).toContain('código 3')
  })

  it('si el ejecutable no existe, error de «CLI no encontrado»', async () => {
    const p = crear({
      lanzador: (_args, { cwd, env }) => spawn('orbe-no-existe-este-programa', [], { cwd, env, stdio: 'pipe' })
    })
    const e = await errorDe(p.enviar({ texto: 'hola' }, recolector()))
    expect(e.error.codigo).toBe('cli_no_encontrado')
  })

  it('rechaza un segundo envío mientras hay un turno en curso', async () => {
    const p = crear()
    const primero = p.enviar({ texto: 'LARGO' }, recolector())
    const e = await errorDe(p.enviar({ texto: 'otro' }, recolector()))
    expect(e.error.codigo).toBe('solicitud_invalida')
    p.cancelar()
    await primero
  })

  it('reiniciar olvida la conversación: nuevo proceso, sin aviso de contexto perdido', async () => {
    const p = crear()
    await p.enviar({ texto: 'uno' }, recolector())
    p.reiniciar()
    const m = recolector()
    await p.enviar({ texto: 'dos' }, m)
    expect(lanzamientos).toHaveLength(2)
    expect(m.texto()).toContain('Turno 1 (1 mensajes en memoria)')
    expect(m.avisos).toEqual([])
  })

  it('reiniciar en mitad de una respuesta la da por cancelada', async () => {
    const p = crear()
    const m = recolector()
    const envio = p.enviar({ texto: 'LARGO' }, m)
    await esperarHasta(() => m.textos.length > 0)
    p.reiniciar()
    expect((await envio).motivo).toBe('cancelado')
  })

  it('precalentar arranca el proceso sin enviar nada y no lo duplica', async () => {
    const p = crear()
    p.precalentar()
    p.precalentar()
    expect(lanzamientos).toHaveLength(1)
    await p.enviar({ texto: 'hola' }, recolector())
    expect(lanzamientos).toHaveLength(1)
  })
})
