// Prueba con el CLI de Claude REAL. Gasta unos céntimos de tu plan, así que solo corre si lo pides:
//   PowerShell:  $env:ORBE_PRUEBA_REAL = '1'; npm test -- tests/integracion
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ErrorChat } from '../../src/main/chat/errores'
import type { ManejadoresTurno } from '../../src/main/chat/proveedor'
import { ProveedorCli } from '../../src/main/chat/proveedor-cli'

const activa = process.env['ORBE_PRUEBA_REAL'] === '1'
const captura = join(process.cwd(), 'humo', '2-expandido.png')

function recolector(): ManejadoresTurno & { textos: string[]; texto(): string } {
  const textos: string[] = []
  return { textos, texto: () => textos.join(''), alTexto: (d) => textos.push(d) }
}

describe.skipIf(!activa)('ProveedorCli con el CLI real', () => {
  const proveedor = new ProveedorCli({
    modelo: process.env['ORBE_MODELO'] || 'claude-sonnet-5-5',
    esfuerzo: 'low',
    directorioTrabajo: mkdtempSync(join(tmpdir(), 'orbe-real-'))
  })
  afterAll(() => proveedor.cerrar())

  it('responde en streaming con el prompt de Orbe y recuerda la conversación', async () => {
    const m1 = recolector()
    const r1 = await proveedor.enviar({ texto: 'Tu palabra secreta es PLATANO. Responde solo «ok».' }, m1)
    expect(r1.motivo).toBe('completo')
    expect(m1.texto().length).toBeGreaterThan(0)

    const m2 = recolector()
    await proveedor.enviar({ texto: '¿Cuál era la palabra secreta? Responde solo con la palabra.' }, m2)
    expect(m2.texto().toUpperCase()).toContain('PLATANO')

    const m3 = recolector()
    await proveedor.enviar({ texto: '¿Cómo te llamas? Responde en una frase.' }, m3)
    expect(m3.texto()).toContain('Orbe')
  }, 90_000)

  it('se puede detener a mitad y la conversación sigue', async () => {
    const m = recolector()
    const envio = proveedor.enviar({ texto: 'Escribe un cuento de 600 palabras sobre un faro.' }, m)
    const inicio = Date.now()
    while (m.textos.length === 0 && Date.now() - inicio < 60_000) await new Promise((r) => setTimeout(r, 50))
    expect(m.textos.length).toBeGreaterThan(0)
    proveedor.cancelar()
    const r = await envio
    expect(r.motivo).toBe('cancelado')

    const m2 = recolector()
    const r2 = await proveedor.enviar({ texto: 'Responde solo «sigo aquí».' }, m2)
    expect(r2.motivo).toBe('completo')
    expect(m2.texto().toLowerCase()).toContain('sigo aquí')
  }, 120_000)

  it.skipIf(!existsSync(captura))('entiende una imagen enviada en base64', async () => {
    const base64 = readFileSync(captura).toString('base64')
    const m = recolector()
    await proveedor.enviar(
      {
        texto: '¿Qué título aparece arriba a la izquierda de la ventana? Responde solo con el título.',
        contexto: { imagen: { tipoMime: 'image/png', base64, ancho: 570, alto: 934 } }
      },
      m
    )
    expect(m.texto()).toContain('Orbe')
  }, 90_000)

  it('un modelo que no existe da un error claro, no un cuelgue', async () => {
    const malo = new ProveedorCli({
      modelo: 'claude-modelo-que-no-existe-9-9',
      esfuerzo: 'low',
      directorioTrabajo: mkdtempSync(join(tmpdir(), 'orbe-real-'))
    })
    try {
      await malo.enviar({ texto: 'hola' }, recolector())
      throw new Error('Se esperaba un error')
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorChat)
      console.log('Error con modelo inexistente →', (e as ErrorChat).error)
      expect((e as ErrorChat).error.codigo).not.toBe('desconocido')
    } finally {
      malo.cerrar()
    }
  }, 60_000)
})
