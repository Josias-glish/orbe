import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { argumentosEcc, crearHerramientaEcc } from '../src/main/agente/herramientas/ecc'
import type { ContextoHerramienta } from '../src/main/agente/tipos'

const ctx = (aprobar: boolean): ContextoHerramienta =>
  ({ senal: new AbortController().signal, preguntar: async () => aprobar, vigilar: () => {}, permitirLocal: false }) as unknown as ContextoHerramienta

function cliFalso(respuesta: string) {
  const llamadas: Array<{ args: string[]; entrada: string; env: NodeJS.ProcessEnv }> = []
  const lanzar = ((_ruta: string, args: string[], op: { env: NodeJS.ProcessEnv }) => {
    const hijo = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: () => true })
    let entrada = ''
    hijo.stdin.on('data', (d) => (entrada += d))
    hijo.stdin.on('end', () => {
      llamadas.push({ args, entrada, env: op.env })
      hijo.stdout.end(respuesta)
      setImmediate(() => hijo.emit('close', 0))
    })
    return hijo
  }) as never
  return { lanzar, llamadas }
}

describe('ecc_tarea', () => {
  it('abre una sesión aparte con el plugin, sin herramientas de Orbe ni plugins heredados', async () => {
    const args = argumentosEcc({ plugin: 'C:/ecc', modelo: 'sonnet', busquedaCli: false })
    expect(args[args.indexOf('--plugin-dir') + 1]).toBe('C:/ecc')
    expect(args[args.indexOf('--tools') + 1]).toBe('Agent,Skill')
    expect(args).not.toContain('--mcp-config')

    process.env['CLAUDE_CODE_PLUGIN_DIRS'] = 'X'
    const { lanzar, llamadas } = cliFalso(JSON.stringify({ result: 'Plan SEO listo', is_error: false }))
    const h = crearHerramientaEcc({ rutaCli: 'claude', plugin: 'C:/ecc', cwd: tmpdir(), carpetaResultados: join(tmpdir(), 'orbe-ecc-res'), modelo: 'sonnet', busquedaCli: true, auto: () => false, lanzar })
    expect((await h.ejecutar({ tarea: 'auditoría SEO de morfy' }, ctx(false))).texto).toMatch(/no quiso/)
    expect(llamadas).toHaveLength(0)
    const r = await h.ejecutar({ tarea: 'auditoría SEO de morfy' }, ctx(true))
    expect(r.texto.startsWith('Plan SEO listo\n\n[Resultado completo guardado en ')).toBe(true)
    expect(readFileSync(r.texto.match(/guardado en (.+?\.md)/)![1]!, 'utf8')).toContain('Plan SEO listo')
    expect(h.maxResultado).toBe(60_000)
    expect(llamadas[0]!.entrada).toBe('auditoría SEO de morfy')
    expect(llamadas[0]!.env['CLAUDE_CODE_PLUGIN_DIRS']).toBeUndefined()
    expect(llamadas[0]!.env['CLAUDE_CODE_DISABLE_BACKGROUND_TASKS']).toBe('1')
    delete process.env['CLAUDE_CODE_PLUGIN_DIRS']
  })

  it('en modo auto no pregunta, y un error del CLI se nota', async () => {
    const { lanzar } = cliFalso(JSON.stringify({ result: 'límite alcanzado', is_error: true }))
    const h = crearHerramientaEcc({ rutaCli: 'claude', plugin: 'C:/ecc', cwd: tmpdir(), carpetaResultados: join(tmpdir(), 'orbe-ecc-res'), modelo: 'sonnet', busquedaCli: false, auto: () => true, lanzar })
    await expect(h.ejecutar({ tarea: 'x' }, ctx(false))).rejects.toThrow(/ECC falló/)
  })
})
