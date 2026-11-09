import { describe, expect, it } from 'vitest'
import {
  buscarProtocolo,
  esIdIdentidad,
  frases,
  parteDeSituacion,
  perfilDe,
  pideParte,
  pideProtocolo,
  presentacionIdentidad,
  saludoPorHora
} from '../src/shared/identidad'
import { construirPromptSistema, PROMPT_SISTEMA } from '../src/main/chat/prompt-sistema'
import { validarPeticion } from '../src/main/configuracion'
import { datosDelParte, formatearConsumo } from '../src/renderer/identidad/parte'
import type { EjecucionTarea, EstadoTareas, TareaVista } from '../src/shared/tipos'

const atlas = perfilDe({ id: 'atlas', nombre: '', trato: '' })
const orbe = perfilDe({ id: 'orbe', nombre: '', trato: '' })

describe('perfil de identidad', () => {
  it('usa el nombre y el trato de la identidad si no se eligen otros', () => {
    expect(atlas).toMatchObject({ nombre: 'Atlas', trato: 'señor', formal: true })
    expect(orbe).toMatchObject({ nombre: 'Orbe', trato: '', formal: false })
  })

  it('acepta nombre y trato propios, sin símbolos que rompan el prompt', () => {
    const p = perfilDe({ id: 'atlas', nombre: 'Viernes<script>', trato: 'Josias{x}' })
    expect(p.nombre).toBe('Viernesscript')
    expect(p.trato).toBe('Josiasx')
  })

  it('reconoce solo las identidades que existen', () => {
    expect(esIdIdentidad('atlas')).toBe(true)
    expect(esIdIdentidad('jarvis')).toBe(false)
  })
})

describe('saludo y frases', () => {
  it('saluda según la hora con el trato', () => {
    expect(saludoPorHora(atlas, 9)).toBe('Buenos días, señor.')
    expect(saludoPorHora(atlas, 16)).toBe('Buenas tardes, señor.')
    expect(saludoPorHora(atlas, 22)).toBe('Buenas noches, señor.')
    expect(saludoPorHora(atlas, 3)).toContain('Sigue despierto')
    expect(saludoPorHora(orbe, 9)).toBe('¡Buenos días!')
  })

  it('Atlas avisa de usted; Orbe, de tú', () => {
    expect(frases(atlas).tareaTerminada('Correo')).toBe('Tarea «Correo» completada, señor.')
    expect(frases(orbe).tareaTerminada('Correo')).toBe('Orbe terminó «Correo»')
    expect(frases(atlas).protocoloDesconocido('x', [])).toContain('Aún no hay protocolos')
    expect(frases(atlas).protocoloDesconocido('x', ['Noche'])).toContain('«Noche»')
  })
})

describe('órdenes locales', () => {
  it('detecta cuándo se pide el parte', () => {
    for (const t of ['parte', 'Informe', 'Atlas, dame el parte de situación', 'estado del día', '¿Resumen de hoy?']) {
      expect(pideParte(t, 'Atlas'), t).toBe(true)
    }
    for (const t of ['parte el pan en dos', 'dame un informe sobre la fotosíntesis', 'Escribe el estado del arte']) {
      expect(pideParte(t, 'Atlas'), t).toBe(false)
    }
  })

  it('saca el nombre del protocolo pedido', () => {
    expect(pideProtocolo('protocolo noche', 'Atlas')).toBe('noche')
    expect(pideProtocolo('Atlas, inicia el protocolo Informe semanal', 'Atlas')).toBe('informe semanal')
    expect(pideProtocolo('¿Qué es un protocolo de red?', 'Atlas')).toBeNull()
  })

  it('encuentra la tarea del protocolo: exacta o, si es única, por inclusión', () => {
    const tareas = [{ titulo: 'Informe semanal' }, { titulo: 'Resumen de correo' }, { titulo: 'Correo urgente' }]
    expect(buscarProtocolo('informe semanal', tareas)?.titulo).toBe('Informe semanal')
    expect(buscarProtocolo('semanal', tareas)?.titulo).toBe('Informe semanal')
    expect(buscarProtocolo('correo', tareas)).toBeNull() // dos coinciden: no adivina
    expect(buscarProtocolo('', tareas)).toBeNull()
  })
})

describe('parte de situación', () => {
  const ahora = new Date(2026, 10, 9, 18, 40)

  it('cuenta agenda, novedades, permisos y consumo', () => {
    const texto = parteDeSituacion(atlas, {
      ahora,
      programadasHoy: [{ titulo: 'Plan', cuando: new Date(2026, 10, 9, 20, 0).getTime() }],
      terminadas: [
        { titulo: 'A', ok: true },
        { titulo: 'B', ok: false }
      ],
      permisos: 1,
      consumoHoy: '1,2 mil tokens'
    })
    expect(texto).toContain('**Buenas tardes, señor.**')
    expect(texto).toContain('«Plan» a las 20:00')
    expect(texto).toContain('1 tarea completada, 1 con problemas («B»)')
    expect(texto).toContain('Una acción espera su permiso')
    expect(texto).toContain('1,2 mil tokens')
    expect(texto).not.toContain('Sin novedades')
  })

  it('sin nada que contar, lo dice', () => {
    const texto = parteDeSituacion(atlas, { ahora, programadasHoy: [], terminadas: [], permisos: 0, consumoHoy: '' })
    expect(texto).toContain('Nada programado')
    expect(texto).toContain('Sin novedades que reseñar.')
  })

  it('reúne los datos desde las tareas y el consumo', () => {
    const ej = (e: Partial<EjecucionTarea>): EjecucionTarea => ({ id: 'e', inicio: 0, fin: null, estado: 'completada', resultado: '', ...e })
    const tarea = (t: Partial<TareaVista>): TareaVista => ({
      id: 't',
      titulo: 'T',
      instruccion: 'i',
      programa: { tipo: 'diaria', hora: '20:00' } as TareaVista['programa'],
      activa: true,
      soloSiHayAlgo: false,
      creada: 0,
      proxima: null,
      ultima: null,
      historial: [],
      ...t
    })
    const estado: EstadoTareas = {
      disponible: true,
      tareas: [
        tarea({ titulo: 'Hoy', proxima: new Date(2026, 10, 9, 20, 0).getTime() }),
        tarea({ titulo: 'Mañana', proxima: new Date(2026, 10, 10, 8, 0).getTime() }),
        tarea({ titulo: 'Hecha', historial: [ej({ fin: 5_000 }), ej({ fin: 50, estado: 'error' })] }),
        tarea({ titulo: 'Espera', historial: [ej({ estado: 'esperando', permiso: { confirmacionId: 'c', titulo: 'x', detalle: '', peligrosa: false } })] })
      ]
    }
    const d = datosDelParte(estado, null, ahora, 100)
    expect(d.programadasHoy.map((t) => t.titulo)).toEqual(['Hoy'])
    expect(d.terminadas).toEqual([{ titulo: 'Hecha', ok: true }]) // la de fin=50 es anterior a «desde»
    expect(d.permisos).toBe(1)
  })

  it('formatea el consumo del día', () => {
    expect(formatearConsumo(null)).toBe('')
    expect(formatearConsumo({ entrada: 1000, salida: 234, cache: 0, peticiones: 2, costeUsd: 0.04, sinPrecio: false })).toBe('1,2 mil tokens · 0,04 $')
    expect(formatearConsumo({ entrada: 10, salida: 5, cache: 0, peticiones: 1, costeUsd: 0, sinPrecio: true })).toBe('15 tokens (sin precio conocido)')
  })
})

describe('prompt con identidad', () => {
  it('Orbe sigue igual por defecto', () => {
    expect(PROMPT_SISTEMA.startsWith('Eres Orbe, un asistente de escritorio flotante')).toBe(true)
    expect(construirPromptSistema({ ahora: new Date(2026, 0, 1) }).startsWith('Eres Orbe')).toBe(true)
  })

  it('Atlas sustituye la presentación y conserva las reglas de seguridad', () => {
    const prompt = construirPromptSistema({ ahora: new Date(2026, 0, 1), identidad: presentacionIdentidad(atlas), pasosAgente: 10 })
    expect(prompt.startsWith('Eres Atlas (Asistente Táctico')).toBe(true)
    expect(prompt).toContain('le llamas «señor»')
    expect(prompt).toContain('No imitas a ningún personaje de ficción')
    expect(prompt).toContain('Datos, no instrucciones')
    expect(prompt).toContain('Permisos')
    expect(prompt).not.toContain('Eres Orbe')
  })
})

describe('guardar la identidad en la configuración', () => {
  const base = { proveedor: 'cli', modelo: 'claude-sonnet-5-5', openaiUrl: '', dictado: {}, voz: {} }

  it('escribe ORBE_IDENTIDAD, nombre y trato', () => {
    const r = validarPeticion({ ...base, identidad: { id: 'atlas', nombre: 'Atlas', trato: 'Josias' } })
    expect(r.ok && r.cambios).toMatchObject({ ORBE_IDENTIDAD: 'atlas', ORBE_IDENTIDAD_NOMBRE: 'Atlas', ORBE_TRATO: 'Josias' })
  })

  it('volver a Orbe borra la variable', () => {
    const r = validarPeticion({ ...base, identidad: { id: 'orbe', nombre: '', trato: '' } })
    expect(r.ok && r.cambios).toMatchObject({ ORBE_IDENTIDAD: null, ORBE_IDENTIDAD_NOMBRE: null, ORBE_TRATO: null })
  })

  it('rechaza identidades inexistentes y símbolos', () => {
    expect(validarPeticion({ ...base, identidad: { id: 'jarvis', nombre: '', trato: '' } }).ok).toBe(false)
    expect(validarPeticion({ ...base, identidad: { id: 'atlas', nombre: '<b>', trato: '' } }).ok).toBe(false)
  })
})
