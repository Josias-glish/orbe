import { definirHerramienta, type Herramienta } from '../tipos'
import { crearEsquema, crearValidador, type Campos } from '../validacion'

const campos = {
  pasos: {
    tipo: 'texto',
    descripcion: 'El plan: pasos numerados, uno por línea, cortos y en el orden en que los harás (p. ej. «1. Busco… 2. Creo el borrador…»).',
    max: 2000
  }
} as const satisfies Campos

/**
 * Modo plan (N3): en una tarea de varios pasos el agente enseña primero el plan numerado y solo sigue si el usuario lo
 * aprueba en la tarjeta. Cada plan se aprueba aparte: nunca vale «para esta tarea».
 */
export function crearProponerPlan(): Herramienta {
  return definirHerramienta<{ pasos: string }>({
    nombre: 'proponer_plan',
    descripcion:
      'Enseña al usuario tu plan numerado y espera a que lo apruebe. Úsala ANTES de actuar cuando la tarea necesite tres o más acciones ' +
      'o alguna que pida permiso. Si no lo aprueba, no actúes: pregúntale qué cambiar.',
    esquema: crearEsquema(campos),
    nivel: 'confirmar',
    validar: crearValidador<{ pasos: string }>(campos),
    describir: () => 'Plan para tu aprobación',
    clasificar: (e) => ({ tipo: 'confirmar', titulo: '¿Sigo este plan?', detalle: e.pasos, etiquetaPermitir: 'Aprobar plan', porTarea: false }),
    async ejecutar() {
      return { texto: 'El usuario aprobó el plan. Síguelo en orden; si tienes que cambiarlo, vuelve a proponerlo antes de actuar.' }
    }
  })
}
