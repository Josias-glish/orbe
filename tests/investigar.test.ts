import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { argumentosInvestigar, crearHerramientaInvestigar, nombreInforme } from '../src/main/agente/herramientas/investigar'
import { documentosIndice } from '../src/main/datos/fuentes'
import { crearHerramientaPdf, htmlInforme } from '../src/main/agente/herramientas/pdf'
import type { ContextoHerramienta } from '../src/main/agente/tipos'

const ctx = (aprobar: boolean, preguntas: string[] = []): ContextoHerramienta =>
  ({
    senal: new AbortController().signal,
    preguntar: async (p: { detalle: string }) => (preguntas.push(p.detalle), aprobar),
    vigilar: () => {},
    permitirLocal: false
  }) as unknown as ContextoHerramienta

function cliFalso(respuesta: string) {
  const entradas: string[] = []
  const lanzar = (() => {
    const hijo = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: () => true })
    let entrada = ''
    hijo.stdin.on('data', (d) => (entrada += d))
    hijo.stdin.on('end', () => {
      entradas.push(entrada)
      hijo.stdout.end(respuesta)
      setImmediate(() => hijo.emit('close', 0))
    })
    return hijo
  }) as never
  return { lanzar, entradas }
}

describe('investigar_a_fondo', () => {
  it('pide aprobar el plan, investiga en sesión aparte y guarda un informe que se puede buscar y ampliar', async () => {
    const args = argumentosInvestigar('sonnet')
    expect(args[args.indexOf('--tools') + 1]).toBe('Agent,WebSearch,WebFetch')
    expect(JSON.parse(args[args.indexOf('--agents') + 1]!).subtema.tools).toEqual(['WebSearch', 'WebFetch'])
    expect(nombreInforme('Agentes de IA en México', new Date('2026-11-12T10:00:00Z'))).toBe('2026-11-12-agentes-de-ia-en-mexico.md')

    const carpeta = mkdtempSync(join(tmpdir(), 'orbe-informes-'))
    const { lanzar, entradas } = cliFalso(JSON.stringify({ result: '# Agentes\n\nTexto [1]\n\n## No verificado\n- x', is_error: false }))
    const h = crearHerramientaInvestigar({ rutaCli: 'claude', cwd: tmpdir(), carpeta, modelo: 'sonnet', lanzar, ahora: () => new Date('2026-11-12T10:00:00Z') })
    const plan = { tema: 'Agentes de IA', subtemas: '1. Mercado\n- Precios\n\nRiesgos' }

    expect((await h.ejecutar(plan, ctx(false))).texto).toMatch(/no aprobó/)
    expect(entradas).toHaveLength(0)

    const preguntas: string[] = []
    const r = await h.ejecutar(plan, ctx(true, preguntas))
    expect(preguntas[0]).toContain('1. Mercado\n2. Precios\n3. Riesgos')
    expect(entradas[0]).toContain('3. Riesgos')
    const archivo = r.texto.match(/guardado en (.+?\.md)/)![1]!
    expect(readFileSync(archivo, 'utf8')).toContain('## No verificado')

    const docs = documentosIndice({ conversaciones: { todas: () => [] }, memoria: { listar: () => [] }, carpetaInformes: carpeta } as never)
    expect(docs[0]).toMatchObject({ tipo: 'informe', ref: '2026-11-12-agentes-de-ia.md', titulo: 'Informe: Agentes' })

    await h.ejecutar({ ...plan, ampliar: '2026-11-12-agentes-de-ia.md' }, ctx(true))
    expect(entradas[1]).toContain('Informe anterior que hay que ampliar (dato):\n# Agentes')
    expect((await h.ejecutar({ ...plan, ampliar: '../../secreto.md' }, ctx(true))).texto).toMatch(/No hay un informe «secreto\.md»/)
  })
})

describe('convertir_a_pdf', () => {
  it('arma el HTML con el diseño de Orbe sin scripts y convierte solo archivos de sus carpetas', async () => {
    const html = htmlInforme('# Informe\n\nTexto [1]\n\n<script>alert(1)</script><img src=x onerror="x()">', 'Informe')
    expect(html).toContain('<h1>Informe</h1>')
    expect(html).toContain('linear-gradient(90deg, #22d3ee, #8b5cf6)')
    expect(html).not.toMatch(/<script|onerror/)

    const carpeta = mkdtempSync(join(tmpdir(), 'orbe-pdf-'))
    writeFileSync(join(carpeta, 'a.md'), '# Título A\n\nhola')
    const hechos: string[] = []
    const h = crearHerramientaPdf([carpeta], async (_md, titulo, ruta) => void hechos.push(`${titulo}|${ruta}`))
    expect((await h.ejecutar({ archivo: '../a.md' }, {} as never)).texto).toMatch(/PDF creado/)
    expect(hechos[0]).toBe(`Título A|${join(carpeta, 'a.pdf')}`)
    expect((await h.ejecutar({ archivo: 'otro.md' }, {} as never)).texto).toMatch(/No encuentro/)
  })
})
