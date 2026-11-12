import { definirHerramienta, type Herramienta } from '../tipos'
import { crearEsquema, crearValidador } from '../validacion'

const campos = {
  agente: { tipo: 'texto', descripcion: 'El agente que lo atiende (p. ej. «correo», «contenido»).', max: 40 },
  encargo: { tipo: 'texto', descripcion: 'Qué tiene que hacer, con todo el contexto que necesite (no verá esta conversación).', max: 4000 }
} as const

/**
 * Buzón entre agentes (A4): deja un encargo a otro agente, que lo atiende en segundo plano como una tarea «ahora»; el
 * resultado queda en Tareas y llega como aviso. No espera la respuesta: para eso está la herramienta Agent.
 */
export function crearHerramientaBuzon(agentes: () => string[], encargar: (agente: string, encargo: string) => string | null): Herramienta {
  return definirHerramienta<{ agente: string; encargo: string }>({
    nombre: 'dejar_encargo',
    descripcion:
      'Deja un encargo a otro agente para que lo haga después, en segundo plano, sin esperar la respuesta (el resultado aparece en ' +
      'Tareas y se avisa al usuario). Úsala cuando el trabajo no hace falta para responder ahora: «que el agente de correo prepare ' +
      'las respuestas», «que contenido haga el calendario de la semana». Si necesitas el resultado para seguir, usa Agent.',
    esquema: crearEsquema(campos),
    nivel: 'libre',
    validar: crearValidador<{ agente: string; encargo: string }>(campos),
    describir: (e) => `Encargo para ${e.agente}`,
    async ejecutar(e) {
      const nombres = agentes()
      if (!nombres.includes(e.agente)) return { texto: `No hay un agente «${e.agente}». Los que hay: ${nombres.join(', ') || 'ninguno'}.` }
      const error = encargar(e.agente, e.encargo)
      return { texto: error ?? `Encargo dejado a «${e.agente}». Lo hará en segundo plano; el resultado aparecerá en Tareas y avisará al usuario.` }
    }
  })
}
