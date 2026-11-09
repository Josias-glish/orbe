import type { EventoActividad } from '../../shared/tipos'
import { normalizarEvento } from './actividad'

/** Resumen corto de lo que va a hacer una herramienta de Claude Code (el comando, el archivo, la búsqueda…). */
function resumenHerramienta(nombre: string, entrada: unknown): string {
  if (typeof entrada !== 'object' || entrada === null) return ''
  const e = entrada as Record<string, unknown>
  const valor = e['command'] ?? e['file_path'] ?? e['path'] ?? e['pattern'] ?? e['url'] ?? e['query'] ?? e['description'] ?? e['prompt']
  if (typeof valor !== 'string') return ''
  return nombre === 'Bash' ? `$ ${valor}` : valor
}

/**
 * Traduce lo que Claude Code manda a sus hooks (el JSON que recibe el comando por la entrada estándar) a un evento
 * de actividad. Así el personaje sabe cuándo Claude Code trabaja, cuándo te necesita y cuándo termina.
 * Devuelve null para los avisos que no aportan nada (p. ej., cada herramienta que acaba bien).
 */
export function deClaudeCode(carga: unknown): EventoActividad | null {
  if (typeof carga !== 'object' || carga === null) return null
  const c = carga as Record<string, unknown>
  const hook = typeof c['hook_event_name'] === 'string' ? c['hook_event_name'] : ''
  // El nombre de la carpeta del proyecto, sea una ruta de Windows o de Unix.
  const proyecto = typeof c['cwd'] === 'string' ? (c['cwd'].split(/[\\/]+/).filter(Boolean).pop() ?? '') : ''
  const en = proyecto ? ` · ${proyecto}` : ''
  const evento = (tipo: string, titulo: string, detalle?: string, expresion?: string): EventoActividad | null =>
    normalizarEvento({ origen: 'claude-code', tipo, titulo, detalle, expresion }, 'claude-code')

  switch (hook) {
    case 'SessionStart':
      return evento('inicio', `Claude Code empezó${en}`, undefined, 'curioso')
    case 'UserPromptSubmit':
      return evento('trabajando', `Claude Code está con tu pedido${en}`, typeof c['prompt'] === 'string' ? c['prompt'] : undefined, 'concentrado')
    case 'PreToolUse': {
      const herramienta = typeof c['tool_name'] === 'string' ? c['tool_name'] : 'una herramienta'
      return evento('trabajando', `Claude Code usa ${herramienta}${en}`, resumenHerramienta(herramienta, c['tool_input']), 'concentrado')
    }
    case 'Notification':
      return evento('esperando', `Claude Code te necesita${en}`, typeof c['message'] === 'string' ? c['message'] : undefined, 'sorprendido')
    case 'Stop':
      return evento('terminado', `Claude Code terminó${en}`, undefined, 'orgulloso')
    case 'SubagentStop':
      return evento('info', `Un subagente de Claude Code terminó${en}`)
    case 'PreCompact':
      return evento('info', `Claude Code está resumiendo la conversación${en}`, undefined, 'pensativo')
    case 'SessionEnd':
      return evento('info', `Sesión de Claude Code cerrada${en}`, undefined, 'neutral')
    default:
      return null
  }
}
