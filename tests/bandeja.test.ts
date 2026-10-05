import { describe, expect, it, vi } from 'vitest'
import { plantillaBandeja, type AccionesBandeja, type EstadoBandeja } from '../src/main/bandeja'

function acciones(): AccionesBandeja {
  return {
    alternarVisibilidad: vi.fn(),
    mostrarPanel: vi.fn(),
    nuevaConversacion: vi.fn(),
    leerPantalla: vi.fn(),
    detenerAccion: vi.fn(),
    salir: vi.fn()
  }
}

const estado = (parcial: Partial<EstadoBandeja> = {}): EstadoBandeja => ({
  visible: true,
  inicioDisponible: true,
  iniciaConWindows: false,
  alCambiarInicio: vi.fn(),
  ...parcial
})

const etiquetas = (p: ReturnType<typeof plantillaBandeja>): string[] => p.map((i) => (i.type === 'separator' ? '---' : String(i.label)))

describe('plantillaBandeja', () => {
  it('ofrece mostrar u ocultar según esté visible', () => {
    expect(etiquetas(plantillaBandeja(acciones(), estado({ visible: true })))[0]).toBe('Ocultar Orbe')
    expect(etiquetas(plantillaBandeja(acciones(), estado({ visible: false })))[0]).toBe('Mostrar Orbe')
  })

  it('tiene las entradas esperadas, y salir al final', () => {
    expect(etiquetas(plantillaBandeja(acciones(), estado()))).toEqual([
      'Ocultar Orbe',
      'Abrir el chat',
      'Nueva conversación',
      'Leer la pantalla',
      '---',
      'Iniciar con Windows',
      'Salir'
    ])
  })

  it('sin la app instalada no ofrece iniciar con Windows', () => {
    expect(etiquetas(plantillaBandeja(acciones(), estado({ inicioDisponible: false })))).not.toContain('Iniciar con Windows')
  })

  it('la casilla refleja el estado y avisa al cambiarla', () => {
    const alCambiarInicio = vi.fn()
    const plantilla = plantillaBandeja(acciones(), estado({ iniciaConWindows: true, alCambiarInicio }))
    const item = plantilla.find((i) => i.label === 'Iniciar con Windows')!
    expect(item.type).toBe('checkbox')
    expect(item.checked).toBe(true)
    ;(item.click as (i: { checked: boolean }) => void)({ checked: false })
    expect(alCambiarInicio).toHaveBeenCalledWith(false)
  })

  it('solo ofrece «Detener acción» (arriba del todo) cuando hay una respuesta o tarea en curso', () => {
    expect(etiquetas(plantillaBandeja(acciones(), estado()))).not.toContain('Detener acción')
    const conTurno = etiquetas(plantillaBandeja(acciones(), estado({ hayTurno: true })))
    expect(conTurno.slice(0, 3)).toEqual(['Detener acción', '---', 'Ocultar Orbe'])
  })

  it('cada entrada lanza su acción', () => {
    const a = acciones()
    const plantilla = plantillaBandeja(a, estado({ hayTurno: true }))
    const pulsar = (etiqueta: string): void => (plantilla.find((i) => i.label === etiqueta)!.click as () => void)()
    pulsar('Detener acción')
    pulsar('Ocultar Orbe')
    pulsar('Abrir el chat')
    pulsar('Nueva conversación')
    pulsar('Leer la pantalla')
    pulsar('Salir')
    for (const f of Object.values(a)) expect(f).toHaveBeenCalledTimes(1)
  })
})
