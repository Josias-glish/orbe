import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AlmacenConversacion } from '../src/main/memoria/conversacion'

describe('historial del chat', () => {
  it('archiva al empezar otra, lista de la más nueva a la más vieja y reabre sin duplicar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbe-hist-'))
    const a = new AlmacenConversacion(join(dir, 'conversacion.json'))
    a.anexar('¿Qué tiempo hace?', 'Soleado.', new Date('2026-11-10T10:00:00Z'))
    a.archivar(new Date('2026-11-10T10:05:00Z'))
    a.vaciar()
    a.anexar('Abre Blender', 'Hecho.', new Date('2026-11-11T09:00:00Z'))
    a.archivar(new Date('2026-11-11T09:05:00Z'))
    a.vaciar()

    const lista = a.listar()
    expect(lista.map((c) => c.titulo)).toEqual(['Abre Blender', '¿Qué tiempo hace?'])

    // Reabrir la vieja, seguirla y archivarla otra vez: se actualiza su archivo, no sale una copia.
    expect(a.abrir(lista[1]!.id)?.[0]?.texto).toBe('¿Qué tiempo hace?')
    a.anexar('¿Y mañana?', 'Lluvia.')
    a.archivar()
    expect(readdirSync(join(dir, 'conversaciones'))).toHaveLength(2)
    expect(a.listar()[0]!.mensajes).toBe(4)

    expect(a.abrir('../conversacion')).toBeNull()
  })
})
