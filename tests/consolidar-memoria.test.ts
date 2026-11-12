import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Recuerdo } from '../src/main/memoria/almacen'
import { caducado, proponerLimpieza, sonDuplicados } from '../src/main/memoria/consolidar'
import { ServicioMemoria } from '../src/main/memoria/servicio'

const r = (id: string, cuerpo: string, modificado = '2026-11-01T00:00:00Z'): Recuerdo => ({
  id, tipo: 'nota', descripcion: cuerpo.slice(0, 30), cuerpo, origen: 'usuario', usar: true, completo: true, modificado
})
const ahora = new Date('2026-11-12T00:00:00Z')

describe('consolidación de la memoria', () => {
  it('detecta duplicados, caducidad y respeta lo descartado', () => {
    expect(sonDuplicados('Mi marca se llama Morfy.', 'mi marca se llama morfy')).toBe(true)
    expect(sonDuplicados('Uso Blender para modelar en 3D', 'Uso Premiere para editar vídeo')).toBe(false)
    const viejo = r('viejo', 'Vivo en Moniquirá', '2026-06-01T00:00:00Z')
    expect(caducado(viejo, null, ahora)).toBe(true)
    expect(caducado(viejo, '2026-11-01T00:00:00Z', ahora)).toBe(false)
    const lista = [r('a', 'Mi marca se llama Morfy.'), r('b', 'mi marca se llama morfy y es de IA'), viejo]
    const p = proponerLimpieza(lista, () => null, ahora, new Set())
    expect(p.map((x) => x.id)).toEqual(['dup:a:b', 'cad:viejo'])
    expect(proponerLimpieza(lista, () => null, ahora, new Set(['dup:a:b'])).map((x) => x.id)).toEqual(['cad:viejo'])
  })

  it('aceptar archiva sin borrar, descartar no vuelve a proponer, y lo caducado solo envía su resumen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbe-cons-'))
    const s = new ServicioMemoria({
      carpeta: join(dir, 'memoria'), archivoConversacion: join(dir, 'c.json'), max: 5000, origenesClaude: [],
      ahora: () => ahora, ultimoUso: () => null
    })
    s.guardarNota('Mi marca se llama Morfy.')
    s.guardarNota('mi marca se llama morfy y es de IA')
    const est = s.estado()
    expect(est.propuestas).toHaveLength(1)
    expect(s.resolverPropuesta(est.propuestas[0]!.id, true).ok).toBe(true)
    expect(s.estado().recuerdos).toHaveLength(1)
    expect(readdirSync(join(dir, 'memoria', '_archivo'))).toHaveLength(1)
    expect(s.resolverPropuesta('nada', true).ok).toBe(false)
  })
})
