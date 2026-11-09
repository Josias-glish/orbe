import type { ProgramaTarea } from './tipos'

/** Describe el programa para la interfaz («Cada día a las 08:30», «Lun, Mié, Vie a las 18:00»…). */
export function describirPrograma(p: ProgramaTarea): string {
  const nombres = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  switch (p.tipo) {
    case 'ahora':
      return 'Una vez, ahora'
    case 'una-vez':
      return `Una vez, el ${new Date(p.en).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`
    case 'diaria':
      return `Cada día a las ${p.hora}`
    case 'semanal':
      return `${[...p.dias].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => nombres[d]).join(', ')} a las ${p.hora}`
    case 'cada':
      return p.minutos % 60 === 0 ? `Cada ${p.minutos / 60} h` : `Cada ${p.minutos} min`
  }
}
