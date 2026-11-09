import type { ProgramaTarea, TareaNueva } from '../../shared/tipos'

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/
export const MINUTOS_MIN = 15
export const MINUTOS_MAX = 7 * 24 * 60
export const TITULO_MAX = 80
export const INSTRUCCION_MAX = 4000

function aMinutos(hora: string): number {
  const m = HORA.exec(hora)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

/** El momento (ms) de hoy a esa hora local, contando desde `base`. */
function aLaHora(base: number, hora: string, diasDespues = 0): number {
  const d = new Date(base)
  const min = aMinutos(hora)
  d.setHours(Math.floor(min / 60), min % 60, 0, 0)
  d.setDate(d.getDate() + diasDespues)
  return d.getTime()
}

/**
 * La próxima vez que toca una tarea, estrictamente después de `despues`. `null` si ya no toca más (una tarea de una
 * sola vez que ya pasó). Las horas son locales: un cambio de hora (verano/invierno) no las mueve.
 */
export function siguienteEjecucion(p: ProgramaTarea, despues: number, creada = despues): number | null {
  switch (p.tipo) {
    case 'ahora':
      return null
    case 'una-vez':
      return p.en > despues ? p.en : null
    case 'cada': {
      const paso = p.minutos * 60_000
      // Siempre en múltiplos desde que se creó: así no se desplaza aunque una ejecución tarde.
      const n = Math.floor((despues - creada) / paso) + 1
      return creada + Math.max(1, n) * paso
    }
    case 'diaria': {
      const hoy = aLaHora(despues, p.hora)
      return hoy > despues ? hoy : aLaHora(despues, p.hora, 1)
    }
    case 'semanal': {
      if (p.dias.length === 0) return null
      for (let i = 0; i <= 7; i++) {
        const t = aLaHora(despues, p.hora, i)
        if (t > despues && p.dias.includes(new Date(t).getDay())) return t
      }
      return null
    }
  }
}

export { describirPrograma } from '../../shared/tareas'

export type ValidacionTarea = { ok: true; tarea: Required<Omit<TareaNueva, 'id'>> & { id?: string } } | { ok: false; error: string }

/** Comprueba lo que llega de la interfaz: textos con límite, horas válidas, intervalos razonables. */
export function validarTarea(entrada: unknown, ahora = Date.now()): ValidacionTarea {
  if (typeof entrada !== 'object' || entrada === null) return { ok: false, error: 'La tarea no es válida.' }
  const e = entrada as Record<string, unknown>
  const instruccion = typeof e.instruccion === 'string' ? e.instruccion.trim() : ''
  if (!instruccion) return { ok: false, error: 'Escribe qué tiene que hacer la tarea.' }
  if (instruccion.length > INSTRUCCION_MAX) return { ok: false, error: `La instrucción es demasiado larga (máximo ${INSTRUCCION_MAX} caracteres).` }
  let titulo = typeof e.titulo === 'string' ? e.titulo.trim().replace(/\s+/g, ' ') : ''
  if (!titulo) titulo = instruccion.replace(/\s+/g, ' ').slice(0, 48) + (instruccion.length > 48 ? '…' : '')
  titulo = titulo.slice(0, TITULO_MAX)
  const p = e.programa as Record<string, unknown> | undefined
  let programa: ProgramaTarea
  switch (p?.tipo) {
    case 'ahora':
      programa = { tipo: 'ahora' }
      break
    case 'una-vez': {
      const en = Number(p.en)
      if (!Number.isFinite(en) || en <= ahora) return { ok: false, error: 'Elige una fecha y hora futuras.' }
      programa = { tipo: 'una-vez', en }
      break
    }
    case 'diaria':
      if (typeof p.hora !== 'string' || !HORA.test(p.hora)) return { ok: false, error: 'La hora debe tener el formato 08:30.' }
      programa = { tipo: 'diaria', hora: p.hora }
      break
    case 'semanal': {
      if (typeof p.hora !== 'string' || !HORA.test(p.hora)) return { ok: false, error: 'La hora debe tener el formato 08:30.' }
      const dias = Array.isArray(p.dias) ? [...new Set(p.dias.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))] : []
      if (dias.length === 0) return { ok: false, error: 'Elige al menos un día de la semana.' }
      programa = { tipo: 'semanal', dias, hora: p.hora }
      break
    }
    case 'cada': {
      const minutos = Math.round(Number(p.minutos))
      if (!Number.isFinite(minutos) || minutos < MINUTOS_MIN || minutos > MINUTOS_MAX) {
        return { ok: false, error: `El intervalo debe estar entre ${MINUTOS_MIN} minutos y 7 días.` }
      }
      programa = { tipo: 'cada', minutos }
      break
    }
    default:
      return { ok: false, error: 'Elige cuándo se hace la tarea.' }
  }
  return {
    ok: true,
    tarea: {
      ...(typeof e.id === 'string' && e.id ? { id: e.id } : {}),
      titulo,
      instruccion,
      programa,
      activa: e.activa !== false,
      soloSiHayAlgo: e.soloSiHayAlgo === true
    }
  }
}
