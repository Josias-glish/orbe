import { describe, expect, it, vi } from 'vitest'
import { crearHerramientasPc } from '../src/main/agente/herramientas/pc'
import { modoDe } from '../src/main/agente/reglas'
import { AccionProhibida, type ContextoHerramienta, type Herramienta } from '../src/main/agente/tipos'
import { ControlPc, motivoBloqueo, parsearTeclas, teclasConEfecto, TOPE_ACCIONES, type VentanaPc } from '../src/main/pc/control'

const BLOC: VentanaPc = { hwnd: 7, proceso: 'notepad', aplicacion: 'Bloc de notas', titulo: 'Sin título', rect: { x: 0, y: 0, ancho: 800, alto: 600 } }
const ELEMENTOS = [
  { n: 1, tipo: 'botón', nombre: 'Guardar', estado: '', rect: { x: 10, y: 10, ancho: 40, alto: 20 } },
  { n: 2, tipo: 'botón', nombre: 'Enviar', estado: '', rect: { x: 60, y: 10, ancho: 40, alto: 20 } },
  { n: 3, tipo: 'campo', nombre: 'Asunto', valor: 'hola', estado: 'con el foco', rect: { x: 10, y: 40, ancho: 200, alto: 20 } },
  { n: 4, tipo: 'botón', nombre: 'Comprar ahora', estado: '', rect: { x: 10, y: 70, ancho: 80, alto: 20 } }
]

/** Un helper de mentira: apunta las operaciones y responde con la ventana que diga `ventana`. */
function montar(ventana: VentanaPc = BLOC, auto = false) {
  const ops: Array<[string, Record<string, unknown>]> = []
  const marco = { mostrar: vi.fn(), ocultar: vi.fn(), senalar: vi.fn() }
  const alUsuario = vi.fn()
  const estado = { ventana }
  const pc = new ControlPc({
    marco,
    alUsuario,
    auto: () => auto,
    capturar: async (r) => ({ jpeg: 'QUJD', ancho: r.ancho / 2, alto: r.alto / 2, origen: { x: r.x, y: r.y }, escala: 2 }),
    esperar: async () => undefined,
    pedir: async <T,>(op: string, p: Record<string, unknown> = {}) => {
      ops.push([op, p])
      if (op === 'elementos') return { ventana: estado.ventana, elementos: ELEMENTOS } as T
      if (op === 'ventana') return { ventana: estado.ventana } as T
      if (op === 'actuar') return { nombre: ELEMENTOS[Number(p['n']) - 1]?.nombre ?? '', hecho: 'pulsado' } as T
      return {} as T
    }
  })
  const h = Object.fromEntries(crearHerramientasPc(pc).map((x) => [x.nombre, x])) as Record<string, Herramienta>
  const preguntas: string[] = []
  const ctx = (respuesta = true): ContextoHerramienta =>
    ({
      senal: new AbortController().signal,
      permitirLocal: false,
      vigilar: () => undefined,
      preguntar: async (p: { titulo: string }) => (preguntas.push(p.titulo), respuesta)
    }) as unknown as ContextoHerramienta
  return { pc, h, ops, marco, alUsuario, estado, preguntas, ctx }
}

describe('Control del PC: seguridad', () => {
  it('bloquea consolas, gestores de contraseñas, bancos y ventanas de administrador', () => {
    expect(motivoBloqueo({ proceso: 'powershell', titulo: '' })).toBeTruthy()
    expect(motivoBloqueo({ proceso: 'WindowsTerminal', titulo: '' })).toBeTruthy()
    expect(motivoBloqueo({ proceso: 'KeePassXC', titulo: '' })).toBeTruthy()
    expect(motivoBloqueo({ proceso: 'chrome', titulo: 'Bancolombia - Sucursal Virtual' })).toMatch(/bancos/)
    expect(motivoBloqueo({ proceso: 'notepad', titulo: 'x', restringida: true })).toMatch(/administrador/)
    expect(motivoBloqueo({ proceso: 'notepad', titulo: 'Sin título' })).toBeUndefined()
  })

  it('las teclas: sin tecla Windows, y Enter, Supr o Alt+F4 tienen efecto', () => {
    expect(parsearTeclas('Ctrl+Mayús+S')).toEqual([0x11, 0x10, 0x53])
    expect(parsearTeclas('AvPág')).toEqual([0x22])
    expect(parsearTeclas('Win+R')).toBeNull()
    expect(teclasConEfecto(parsearTeclas('Alt+F4')!)).toBe(true)
    expect(teclasConEfecto(parsearTeclas('Ctrl+S')!)).toBe(false)
  })

  it('el permiso va por app y, sin regla propia, toma el general', () => {
    expect(modoDe('pc_notepad.control', {})).toBe('preguntar')
    expect(modoDe('pc_spotify.control', { 'pc_spotify.control': 'libre' })).toBe('libre')
    expect(modoDe('pc_notepad.ver', {})).toBe('libre')
  })

  it('no mira una ventana bloqueada ni actúa si su título cambió a un banco', async () => {
    const m = montar({ ...BLOC, proceso: 'cmd' })
    await expect(m.h['pc_ver']!.ejecutar({}, m.ctx())).rejects.toBeInstanceOf(AccionProhibida)

    const b = montar()
    await b.h['pc_ver']!.ejecutar({}, b.ctx())
    b.estado.ventana = { ...BLOC, proceso: 'chrome', titulo: 'PayPal: pagar' }
    await expect(b.h['pc_pulsar']!.ejecutar({ n: 1 }, b.ctx())).rejects.toBeInstanceOf(AccionProhibida)
    expect(b.ops.some(([op]) => op === 'actuar')).toBe(false)
  })
})

describe('Control del PC: actuar', () => {
  it('pulsa por número, enciende el borde y la vigilancia, y relee la ventana', async () => {
    const m = montar()
    expect((await m.h['pc_ver']!.ejecutar({}, m.ctx())).texto).toContain('[1] botón «Guardar» en 30,20')
    const r = await m.h['pc_pulsar']!.ejecutar({ n: 1 }, m.ctx())
    expect(r.texto).toMatch(/«Guardar»: pulsado[\s\S]*Ventana ahora/)
    expect(m.ops.map(([op]) => op)).toEqual(['elementos', 'ventana', 'vigilar', 'actuar', 'elementos'])
    expect(m.marco.mostrar).toHaveBeenCalledOnce()
    expect(m.preguntas).toEqual([])
    expect(m.pc.accion('control')).toBe('pc_notepad.control')
  })

  it('un botón con efecto pide permiso siempre; si se niega, no se pulsa', async () => {
    const m = montar()
    await m.h['pc_ver']!.ejecutar({}, m.ctx())
    await expect(m.h['pc_pulsar']!.ejecutar({ n: 2 }, m.ctx(false))).rejects.toThrow(/no lo permitió/)
    expect(m.preguntas).toEqual(['Pulsar «Enviar» en Bloc de notas'])
    expect(m.ops.some(([op]) => op === 'actuar')).toBe(false)
  })

  it('si el usuario toca el ratón, para todo y no deja seguir', async () => {
    const m = montar()
    await m.h['pc_ver']!.ejecutar({}, m.ctx())
    await m.h['pc_pulsar']!.ejecutar({ n: 1 }, m.ctx())
    m.pc.usuarioIntervino()
    expect(m.alUsuario).toHaveBeenCalledOnce()
    expect(m.marco.ocultar).toHaveBeenCalled()
    await expect(m.h['pc_pulsar']!.ejecutar({ n: 1 }, m.ctx())).rejects.toThrow(/tomó el control/)
  })

  it(`tras ${TOPE_ACCIONES} acciones seguidas pregunta si sigue`, async () => {
    const m = montar()
    await m.h['pc_ver']!.ejecutar({}, m.ctx())
    for (let i = 0; i < TOPE_ACCIONES; i++) await m.h['pc_marcar']!.ejecutar({ n: 1 }, m.ctx())
    await expect(m.h['pc_marcar']!.ejecutar({ n: 1 }, m.ctx(false))).rejects.toThrow(/no quiso que siga/)
  })

  it('en modo auto, Enviar no pregunta pero Comprar sí; Enter nunca pregunta', async () => {
    const m = montar(BLOC, true)
    await m.h['pc_ver']!.ejecutar({}, m.ctx())
    await m.h['pc_pulsar']!.ejecutar({ n: 2 }, m.ctx())
    await m.h['pc_teclas']!.ejecutar({ teclas: 'Enter' }, m.ctx())
    expect(m.preguntas).toEqual([])
    await expect(m.h['pc_pulsar']!.ejecutar({ n: 4 }, m.ctx(false))).rejects.toThrow(/no lo permitió/)
    expect(m.preguntas).toEqual(['Pulsar «Comprar ahora» en Bloc de notas'])
  })

  it('«Muéstrame cómo» señala el elemento sin tocar nada', async () => {
    const m = montar()
    await m.h['pc_ver']!.ejecutar({}, m.ctx())
    await m.h['pc_senalar']!.ejecutar({ n: 1, explicacion: 'Pulsa aquí' }, m.ctx())
    expect(m.marco.senalar).toHaveBeenCalledWith(ELEMENTOS[0]!.rect, 'Pulsa aquí')
    expect(m.ops.some(([op]) => op === 'actuar')).toBe(false)
  })
})

describe('pc_mirar', () => {
  it('da la imagen de la ventana y pc_clic con imagen pasa sus píxeles a la pantalla', async () => {
    const m = montar()
    const r = await m.h['pc_mirar']!.ejecutar({}, m.ctx())
    expect(r.imagen).toBe('QUJD')
    expect(r.texto).toContain('400×300')
    m.pc.pedir = (async (op: string, p?: Record<string, unknown>) => {
      m.ops.push([op, p ?? {}])
      return op === 'punto' ? { hwnd: 7, nombre: null } : op === 'ventana' || op === 'elementos' ? { ventana: BLOC, elementos: [] } : {}
    }) as typeof m.pc.pedir
    await m.h['pc_clic']!.ejecutar({ x: 100, y: 50, imagen: true }, m.ctx())
    expect(m.ops.find(([op]) => op === 'clic')?.[1]).toMatchObject({ x: 200, y: 100 })
    await expect(m.h['pc_clic']!.ejecutar({ x: 900, y: 50, imagen: true }, m.ctx())).rejects.toThrow(/fuera de la imagen/)
  })
})

describe('ver_pagina', () => {
  it('lee el texto de la página abierta como contenido de fuera, y no la de un banco', async () => {
    const web: VentanaPc = { ...BLOC, proceso: 'chrome', aplicacion: 'Google Chrome', titulo: 'Noticias', url: 'https://ejemplo.com/a', esNavegador: true }
    const m = montar(web)
    const original = m.pc.pedir.bind(m.pc)
    m.pc.pedir = (async (op: string, p?: Record<string, unknown>) => (op === 'contenido' ? { texto: 'Titular de hoy' } : original(op, p))) as typeof m.pc.pedir
    const r = await m.h['ver_pagina']!.ejecutar({}, m.ctx())
    expect(r.texto).toBe('Google Chrome — «Noticias»\nhttps://ejemplo.com/a\n\nTitular de hoy')
    expect(r.externo).toEqual({ origen: 'Página web abierta', url: 'https://ejemplo.com/a' })

    const b = montar({ ...web, titulo: 'Bancolombia' })
    await expect(b.h['ver_pagina']!.ejecutar({}, b.ctx())).rejects.toBeInstanceOf(AccionProhibida)
  })
})
