import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BaseOrbe, consultaFts } from '../src/main/datos/base'
import { documentosIndice } from '../src/main/datos/fuentes'
import { AlmacenMemoria } from '../src/main/memoria/almacen'
import { AlmacenConversacion } from '../src/main/memoria/conversacion'

describe('base de datos local: búsqueda', () => {
  it('encuentra sin tildes y por prefijo, y ningún texto rompe la consulta', () => {
    expect(consultaFts('cámara "x" OR NEAR(')).toBe('"cámara"* "OR"* "NEAR"*')
    expect(consultaFts('?? !')).toBeNull()
    const base = new BaseOrbe(':memory:')
    base.reindexar([
      { tipo: 'recuerdo', ref: 'r1', titulo: 'Cámara', texto: 'Uso una Cámara Sony para los reels', fecha: '2026-11-01' },
      { tipo: 'conversacion', ref: 'c1', titulo: 'Blender', texto: 'Usuario: abre Blender', fecha: '2026-11-02' }
    ])
    const r = base.buscar('camara son')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ tipo: 'recuerdo', ref: 'r1' })
    expect(r[0]!.fragmento).toContain('«Cámara»')
    expect(base.buscar('blender', { tipos: ['recuerdo'] })).toEqual([])
    expect(base.buscar('"); DROP TABLE indice; --')).toEqual([])
    base.cerrar()
  })

  it('indexa conversaciones (también la actual), recuerdos, métricas y contenido desde sus archivos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbe-base-'))
    const conv = new AlmacenConversacion(join(dir, 'conversacion.json'))
    conv.anexar('¿Cuándo publico el reel de Dario?', 'El jueves.')
    const mem = new AlmacenMemoria(join(dir, 'memoria'))
    mem.guardar({ id: 'nota-a', tipo: 'nota', descripcion: 'Marca', cuerpo: 'Mi marca es morfy', origen: 'usuario', fuente: 'A mano', usar: true, completo: true, modificado: '2026-11-12T00:00:00Z' })
    writeFileSync(join(dir, 'metricas.json'), JSON.stringify({ historial: { morfy: [{ fecha: '2026-11-12', seguidores: 822, alcanceMedio: 571 }] } }))
    writeFileSync(join(dir, 'contenido.json'), JSON.stringify([{ id: 'x1', marca: 'morfy', idea: 'Historia de Dario Amodei', texto: 'De la biofísica a Claude', pie: 'Pie' }]))
    const docs = documentosIndice({ conversaciones: conv, memoria: mem, rutaMetricas: join(dir, 'metricas.json'), rutaContenido: join(dir, 'contenido.json') })
    expect(docs.map((d) => `${d.tipo}:${d.ref}`)).toEqual(['conversacion:actual', 'recuerdo:nota-a', 'metricas:morfy', 'contenido:x1'])
    expect(mem.obtener('nota-a')?.fuente).toBe('A mano')
    const base = new BaseOrbe(join(dir, 'data', 'u', 'orbe.db'))
    base.reindexar(docs)
    expect(base.buscar('dario').map((r) => r.tipo).sort()).toEqual(['contenido', 'conversacion'])
    expect(base.buscar('822')[0]?.tipo).toBe('metricas')
    base.cerrar()
  })
})
