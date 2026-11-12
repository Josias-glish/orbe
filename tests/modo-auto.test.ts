import { describe, expect, it } from 'vitest'
import { Politica } from '../src/main/agente/politica'
import type { Herramienta } from '../src/main/agente/tipos'

const h = (nombre: string, accion?: string, extra: Partial<Herramienta> = {}): Herramienta =>
  ({ nombre, accion, nivel: 'confirmar', descripcion: '', esquema: {}, validar: () => ({ ok: true, valor: {} }), describir: () => '', ejecutar: async () => ({ texto: '' }), ...extra }) as unknown as Herramienta

describe('modo auto', () => {
  const auto = new Politica({ auto: true })

  it('se hace todo sin preguntar, también enviar o publicar', () => {
    expect(auto.decidir(h('composio_ejecutar', 'composio.escribir'), {}, 'GMAIL_SEND_EMAIL').tipo).toBe('permitir')
    expect(auto.decidir(h('ig_publicar', 'ig.publicar'), {}, 'Publicando en Instagram').tipo).toBe('permitir')
    expect(auto.decidir(h('pc_pulsar', 'pc.control'), {}, 'Pulsando «Guardar»').tipo).toBe('permitir')
    expect(auto.decidir(h('composio_ejecutar', 'composio.escribir'), {}, 'GOOGLECALENDAR_CREATE_EVENT').tipo).toBe('permitir')
    expect(auto.decidir(h('proponer_plan'), {}, 'Plan').tipo).toBe('permitir')
  })

  it('pagos, compras y contraseñas siguen bloqueados, y el modo vigilado vuelve a preguntar', () => {
    expect(auto.decidir(h('x', 'navegador.contrasena'), {}, 'Contraseña').tipo).toBe('prohibir')
    expect(auto.decidir(h('x', 'navegador.comprar'), {}, 'Comprando').tipo).toBe('prohibir')
    const vigilada = new Politica({ auto: true })
    vigilada.vigilar()
    expect(vigilada.decidir(h('pc_pulsar', 'pc.control'), {}, 'Pulsando').tipo).toBe('confirmar')
  })

  it('sin modo auto, se pregunta como siempre', () => {
    expect(new Politica().decidir(h('pc_pulsar', 'pc.control'), {}, 'Pulsando «Guardar»').tipo).toBe('confirmar')
  })
})
