import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({}))
import { duracion, textoPlano } from '../src/renderer/tareas/formato'

describe('vista de las tareas', () => {
  it('la vista previa quita el Markdown y las direcciones largas', () => {
    const md = '## Noticias\n\n1. **Nvidia:** su consejo habría abierto una investigación. [AI Weekly](https://ai.example.com/x?y=1)\n2. Café con IA (https://cafeconia.substack.com/p/cafe-con-ia-8)\n- `código` y _énfasis_'
    const t = textoPlano(md)
    expect(t).toBe('Noticias · Nvidia: su consejo habría abierto una investigación. AI Weekly · Café con IA · código y énfasis')
    expect(t).not.toMatch(/https?:|\*\*|##|\(\)/)
  })

  it('la duración se lee fácil', () => {
    expect(duracion(12_000)).toBe('12 s')
    expect(duracion(3 * 60_000)).toBe('3 min')
    expect(duracion(65 * 60_000)).toBe('1 h 5 min')
  })
})
