import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AlmacenMemoria, MAX_CUERPO, MAX_RECUERDOS } from '../src/main/memoria/almacen'
import { prepararMemoriaDeMentira } from '../src/main/memoria/fuente-demo'
import { ServicioMemoria, type OpcionesServicioMemoria } from '../src/main/memoria/servicio'

function crear(extra: Partial<OpcionesServicioMemoria> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'orbe-svc-'))
  const reloj = { ahora: new Date('2026-10-04T10:00:00.000Z') }
  const opciones: OpcionesServicioMemoria = {
    carpeta: join(base, 'memoria'),
    archivoConversacion: join(base, 'conversacion.json'),
    max: 6000,
    origenesClaude: prepararMemoriaDeMentira(base),
    ahora: () => reloj.ahora,
    ...extra
  }
  return { base, reloj, opciones, servicio: new ServicioMemoria(opciones), otraInstancia: () => new ServicioMemoria(opciones) }
}

function limpio(extra: Partial<OpcionesServicioMemoria> = {}) {
  return crear({ origenesClaude: [], ...extra })
}

describe('ServicioMemoria: primer arranque e importación', () => {
  it('la primera vez trae la memoria de Claude y avisa una sola vez', () => {
    const { servicio, otraInstancia } = crear()
    servicio.iniciar()
    expect(servicio.estado().recuerdos).toHaveLength(3)

    const inicio = servicio.inicioPanel()
    expect(inicio.bienvenida).toMatch(/^He cargado 3 notas de la memoria de Claude/)
    expect(servicio.inicioPanel().bienvenida).toBeNull()

    // En otro arranque no se vuelve a importar ni a avisar.
    const segundo = otraInstancia()
    segundo.iniciar()
    expect(segundo.estado().recuerdos).toHaveLength(3)
    expect(segundo.inicioPanel().bienvenida).toBeNull()
  })

  it('si no hay nada que traer, no hay aviso', () => {
    const { servicio } = limpio()
    servicio.iniciar()
    expect(servicio.estado().recuerdos).toEqual([])
    expect(servicio.inicioPanel().bienvenida).toBeNull()
  })

  it('el aviso concuerda en singular', () => {
    const base = mkdtempSync(join(tmpdir(), 'orbe-svc-'))
    const carpetaClaude = join(base, 'claude')
    mkdirSync(carpetaClaude)
    writeFileSync(join(carpetaClaude, 'user-uno.md'), '---\nname: user-uno\ndescription: "Perfil"\nmetadata:\n  type: user\n---\nTexto')
    const unica = new ServicioMemoria({
      carpeta: join(base, 'memoria'),
      archivoConversacion: join(base, 'conversacion.json'),
      max: 6000,
      origenesClaude: [carpetaClaude]
    })
    unica.iniciar()
    expect(unica.inicioPanel().bienvenida).toMatch(/^He cargado 1 nota de la memoria de Claude/)
  })

  it('importar a mano trae lo nuevo y cuenta lo omitido', () => {
    const { servicio } = crear()
    servicio.iniciar()
    const informe = servicio.importar()
    expect(informe).toMatchObject({ nuevas: 0, sinCambios: 3, fuentes: 1 })
    expect(informe.omitidas).toHaveLength(2)
  })

  it('borrar algo importado hace que no vuelva al importar de nuevo', () => {
    const { servicio } = crear()
    servicio.iniciar()
    expect(servicio.borrar('preferencias-demo').ok).toBe(true)
    const informe = servicio.importar()
    expect(informe.nuevas).toBe(0)
    expect(informe.omitidas.some((o) => o.nombre === 'preferencias-demo' && /borraste/.test(o.motivo))).toBe(true)
    expect(servicio.estado().recuerdos.map((r) => r.id)).not.toContain('preferencias-demo')
  })

  it('vaciar lo borra todo y no vuelve a importar en el siguiente arranque', () => {
    const { servicio, otraInstancia } = crear()
    servicio.iniciar()
    const r = servicio.vaciar()
    expect(r.ok && r.estado.recuerdos).toEqual([])
    const siguiente = otraInstancia()
    siguiente.iniciar()
    expect(siguiente.estado().recuerdos).toEqual([])
  })
})

describe('ServicioMemoria: lo que viaja en el prompt', () => {
  it('el perfil viaja entero; los proyectos y preferencias, resumidos', () => {
    const { servicio } = crear()
    servicio.iniciar()
    const bloque = servicio.bloquePrompt()!
    expect(bloque).toContain('<memoria>')
    expect(bloque).toContain('[Perfil] Quién es el usuario (demo)')
    expect(bloque).toContain('Persona de ejemplo para la prueba visual') // cuerpo del perfil
    expect(bloque).toContain('[Proyecto] Huerto urbano en el balcón (demo)')
    expect(bloque).not.toContain('Detalles del huerto de ejemplo') // cuerpo del proyecto: solo con «completo»
    expect(bloque).not.toContain('Ver [[') // los enlaces de Claude no llegan
  })

  it('marcar «completo» envía el texto entero; desmarcar «usar» lo quita', () => {
    const { servicio } = crear()
    servicio.iniciar()
    servicio.actualizar('proyecto-huerto-demo', { completo: true })
    expect(servicio.bloquePrompt()).toContain('Detalles del huerto de ejemplo')
    servicio.actualizar('proyecto-huerto-demo', { usar: false })
    expect(servicio.bloquePrompt()).not.toContain('Huerto urbano')
  })

  it('apagada la memoria no viaja nada, y al encenderla vuelve', () => {
    const { servicio } = crear()
    servicio.iniciar()
    servicio.fijarActiva(false)
    expect(servicio.activa()).toBe(false)
    expect(servicio.bloquePrompt()).toBeUndefined()
    servicio.fijarActiva(true)
    expect(servicio.bloquePrompt()).toBeDefined()
  })

  it('sin recuerdos no hay bloque', () => {
    const { servicio } = limpio()
    servicio.iniciar()
    expect(servicio.bloquePrompt()).toBeUndefined()
  })

  it('el estado cuenta lo que ocupa cada recuerdo y el total', () => {
    const { servicio } = crear({ max: 6000 })
    servicio.iniciar()
    const e = servicio.estado()
    expect(e.activa).toBe(true)
    expect(e.presupuesto.max).toBe(6000)
    expect(e.presupuesto.omitidos).toBe(0)
    expect(e.recuerdos.every((r) => r.caracteres > 0)).toBe(true)
    expect(e.presupuesto.usados).toBeGreaterThanOrEqual(e.recuerdos.reduce((s, r) => s + r.caracteres, 0))
    expect(e.recuerdos.find((r) => r.id === 'user-perfil-demo')).toMatchObject({ tipo: 'usuario', origen: 'claude', usar: true, completo: true })
  })

  it('con poco presupuesto avisa de lo que no cabe', () => {
    const { servicio } = crear({ max: 200 })
    servicio.iniciar()
    const e = servicio.estado()
    expect(e.presupuesto.omitidos).toBeGreaterThan(0)
    expect(e.recuerdos.some((r) => r.caracteres === 0)).toBe(true)
  })
})

describe('ServicioMemoria: notas del usuario', () => {
  it('guarda una nota, con su resumen de una línea', () => {
    const { servicio, reloj } = limpio()
    const r = servicio.guardarNota('Mi comida favorita es la tortilla.\nSobre todo con cebolla.')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const nota = r.estado.recuerdos[0]
    expect(nota).toMatchObject({
      id: r.id,
      tipo: 'nota',
      origen: 'usuario',
      titulo: 'Mi comida favorita es la tortilla.',
      cuerpo: 'Mi comida favorita es la tortilla.\nSobre todo con cebolla.',
      usar: true,
      completo: true,
      modificado: reloj.ahora.toISOString()
    })
    expect(r.id).toMatch(/^nota-mi-comida-favorita/)
  })

  it('repetir lo mismo no duplica', () => {
    const { servicio } = limpio()
    const a = servicio.guardarNota('Me gusta el té')
    const b = servicio.guardarNota('  me gusta el TÉ ')
    expect(a.ok && b.ok && a.id === b.id).toBe(true)
    expect(servicio.estado().recuerdos).toHaveLength(1)
  })

  it('rechaza lo vacío, lo larguísimo y pasarse del máximo de recuerdos', () => {
    const { servicio, opciones } = limpio()
    expect(servicio.guardarNota('   ')).toMatchObject({ ok: false })
    expect(servicio.guardarNota('x'.repeat(MAX_CUERPO + 1))).toMatchObject({ ok: false, error: expect.stringContaining('demasiado largo') })

    const almacen = new AlmacenMemoria(opciones.carpeta)
    for (let i = 0; i < MAX_RECUERDOS; i++) {
      almacen.guardar({ id: `n-${i}`, tipo: 'nota', descripcion: `Recuerdo ${i}`, cuerpo: `Recuerdo ${i}`, origen: 'usuario', usar: true, completo: true, modificado: '2026-10-01T00:00:00.000Z' })
    }
    expect(servicio.guardarNota('Uno más')).toMatchObject({ ok: false, error: expect.stringContaining(String(MAX_RECUERDOS)) })
  })

  it('no guarda contraseñas ni claves, salvo que el usuario insista', () => {
    const { servicio } = limpio()
    const r = servicio.guardarNota('mi contraseña es hunter22')
    expect(r).toMatchObject({ ok: false, sensible: true })
    expect(r.ok === false && r.error).toMatch(/Parece contener una contraseña o una clave/)
    expect(servicio.estado().recuerdos).toEqual([])
    expect(servicio.guardarNota('mi contraseña es hunter22', true).ok).toBe(true)
    expect(servicio.estado().recuerdos).toHaveLength(1)
  })

  it('actualizar cambia ajustes sin tocar la fecha, y el texto con fecha nueva', () => {
    const { servicio, reloj } = limpio()
    const creada = servicio.guardarNota('Nota original')
    if (!creada.ok || !creada.id) throw new Error('no se creó')
    const t0 = reloj.ahora.toISOString()

    reloj.ahora = new Date('2026-10-05T09:00:00.000Z')
    servicio.actualizar(creada.id, { usar: false, completo: false })
    expect(servicio.estado().recuerdos[0]).toMatchObject({ usar: false, completo: false, modificado: t0 })

    reloj.ahora = new Date('2026-10-06T09:00:00.000Z')
    servicio.actualizar(creada.id, { titulo: 'Resumen nuevo', cuerpo: 'Texto nuevo' })
    expect(servicio.estado().recuerdos[0]).toMatchObject({ titulo: 'Resumen nuevo', cuerpo: 'Texto nuevo', modificado: '2026-10-06T09:00:00.000Z' })
  })

  it('actualizar valida: resumen vacío o largo, texto largo, datos delicados y recuerdos que no existen', () => {
    const { servicio } = limpio()
    const creada = servicio.guardarNota('Nota normal')
    if (!creada.ok || !creada.id) throw new Error('no se creó')
    expect(servicio.actualizar(creada.id, { titulo: '  ' })).toMatchObject({ ok: false })
    expect(servicio.actualizar(creada.id, { titulo: 'x'.repeat(301) })).toMatchObject({ ok: false })
    expect(servicio.actualizar(creada.id, { cuerpo: 'x'.repeat(MAX_CUERPO + 1) })).toMatchObject({ ok: false })
    expect(servicio.actualizar(creada.id, { cuerpo: 'el PIN = 4821' })).toMatchObject({ ok: false, sensible: true })
    expect(servicio.actualizar(creada.id, { cuerpo: 'el PIN = 4821' }, true).ok).toBe(true)
    expect(servicio.actualizar('no-existe', { usar: false })).toMatchObject({ ok: false })
  })

  it('borrar una nota propia no la «ignora» para siempre', () => {
    const { servicio, otraInstancia } = limpio()
    const creada = servicio.guardarNota('Para borrar')
    if (!creada.ok || !creada.id) throw new Error('no se creó')
    expect(servicio.borrar(creada.id).ok).toBe(true)
    expect(servicio.borrar(creada.id)).toMatchObject({ ok: false })
    expect(otraInstancia().estado().recuerdos).toEqual([])
  })
})

describe('ServicioMemoria: órdenes «recuerda que…»', () => {
  it('guarda el dato y le cuenta al modelo lo que hizo (él no puede guardar nada)', () => {
    const { servicio } = limpio()
    const c = servicio.capturar('Recuerda que mi número favorito es el 7')!
    expect(c.aviso).toMatchObject({ tipo: 'guardado', texto: 'Mi número favorito es el 7' })
    expect(c.nota).toContain('Orbe ha guardado esta nota en la memoria del usuario: «Mi número favorito es el 7»')
    const [nota] = servicio.estado().recuerdos
    expect(nota).toMatchObject({ tipo: 'nota', origen: 'usuario', cuerpo: 'Mi número favorito es el 7' })
    expect(c.aviso.tipo === 'guardado' && c.aviso.id).toBe(nota.id)
  })

  it('si ya lo tenía, no lo duplica y lo dice', () => {
    const { servicio } = limpio()
    servicio.capturar('Recuerda que vivo en Valencia')
    const c = servicio.capturar('recuerda que vivo en valencia')!
    expect(c.nota).toMatch(/ya lo tenía/)
    expect(servicio.estado().recuerdos).toHaveLength(1)
  })

  it('un dato delicado no se guarda y se le explica al usuario', () => {
    const { servicio } = limpio()
    const c = servicio.capturar('Recuerda que mi contraseña es hunter22')!
    expect(c.aviso).toMatchObject({ tipo: 'no_guardado' })
    expect(c.aviso.tipo === 'no_guardado' && c.aviso.motivo).toBe('parece contener una contraseña o una clave')
    expect(c.nota).toMatch(/Orbe NO ha guardado/)
    expect(c.nota).toContain('Motivo: parece contener una contraseña o una clave.')
    expect(c.nota).toMatch(/no compartir datos así/)
    expect(servicio.estado().recuerdos).toEqual([])
  })

  it('con la memoria apagada no guarda y lo dice', () => {
    const { servicio } = limpio()
    servicio.fijarActiva(false)
    const c = servicio.capturar('Recuerda que me gusta el té')!
    expect(c.aviso).toEqual({ tipo: 'no_guardado', motivo: 'la memoria está desactivada' })
    expect(c.nota).toMatch(/botón de memoria/)
    expect(servicio.estado().recuerdos).toEqual([])
  })

  it('lo que no es una orden de memoria no hace nada', () => {
    const { servicio } = limpio()
    expect(servicio.capturar('¿Qué tiempo hará mañana?')).toBeNull()
    expect(servicio.capturar('Recuerda que mi número favorito es el 7. Preséntate.')).toBeNull()
    expect(servicio.estado().recuerdos).toEqual([])
  })
})

describe('ServicioMemoria: conversación guardada', () => {
  it('lo que se habló sobrevive a un reinicio: se repone en el panel y se le cuenta al modelo una vez', () => {
    const { servicio, otraInstancia } = limpio()
    servicio.iniciar()
    servicio.turnoCompletado('Mi número favorito es el 7', 'Anotado, el 7.')

    const tras = otraInstancia()
    tras.iniciar()
    expect(tras.inicioPanel().mensajes).toEqual([
      { rol: 'usuario', texto: 'Mi número favorito es el 7' },
      { rol: 'asistente', texto: 'Anotado, el 7.' }
    ])
    const historial = tras.tomarHistorialPrevio()!
    expect(historial).toContain('Usuario: Mi número favorito es el 7')
    expect(historial).toContain('Orbe: Anotado, el 7.')

    // Hasta que el envío no se confirma, sigue disponible (si falla, el reintento lo vuelve a llevar).
    expect(tras.tomarHistorialPrevio()).toBe(historial)
    tras.confirmarHistorialUsado()
    expect(tras.tomarHistorialPrevio()).toBeNull()
  })

  it('«nueva conversación» lo olvida todo', () => {
    const { servicio, otraInstancia, opciones } = limpio()
    servicio.iniciar()
    servicio.turnoCompletado('a', 'b')
    expect(servicio.estado().hayConversacion).toBe(true)
    servicio.nuevaConversacion()
    expect(servicio.estado().hayConversacion).toBe(false)
    expect(servicio.tomarHistorialPrevio()).toBeNull()
    expect(existsSync(opciones.archivoConversacion)).toBe(false)
    const tras = otraInstancia()
    tras.iniciar()
    expect(tras.inicioPanel().mensajes).toEqual([])
  })

  it('con la memoria apagada no se guarda ni se repone nada', () => {
    const { servicio, otraInstancia } = limpio()
    servicio.iniciar()
    servicio.fijarActiva(false)
    servicio.turnoCompletado('secreto', 'respuesta')
    expect(servicio.estado().hayConversacion).toBe(false)

    servicio.fijarActiva(true)
    servicio.turnoCompletado('visible', 'respuesta')
    servicio.fijarActiva(false)
    const tras = otraInstancia()
    tras.iniciar()
    expect(tras.inicioPanel().mensajes).toEqual([])
    expect(tras.tomarHistorialPrevio()).toBeNull()
  })

  it('un intercambio con un lado vacío no se guarda', () => {
    const { servicio } = limpio()
    servicio.turnoCompletado('hola', '   ')
    servicio.turnoCompletado('', 'respuesta')
    expect(servicio.estado().hayConversacion).toBe(false)
  })

  it('no deja archivos temporales a medias en la carpeta de datos', () => {
    const { servicio, base } = limpio()
    servicio.turnoCompletado('a', 'b')
    servicio.guardarNota('una nota')
    const archivos = [...readdirSync(base), ...readdirSync(join(base, 'memoria'))]
    expect(archivos.filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(archivos).toContain('conversacion.json')
  })
})
