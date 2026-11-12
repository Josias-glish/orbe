import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parsearNota, serializarNota } from '../memoria/formato'

export const NOMBRE_SKILL = /^[a-z0-9][a-z0-9-]{0,39}$/
export const MAX_SKILL = 8000

export interface Skill {
  nombre: string
  descripcion: string
  cuerpo: string
}

/**
 * Las skills propias del usuario (Etapa 9): `<carpeta>/<nombre>/SKILL.md`, solo texto con instrucciones. Orbe lee
 * únicamente ese archivo: nunca ejecuta nada de la carpeta ni instala skills de terceros.
 */
export class AlmacenSkills {
  constructor(readonly carpeta: string) {}

  listar(): Skill[] {
    let nombres: string[] = []
    try {
      nombres = readdirSync(this.carpeta).filter((n) => NOMBRE_SKILL.test(n))
    } catch {
      return []
    }
    return nombres.map((n) => this.leer(n)).filter((s): s is Skill => s !== null).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }

  leer(nombre: string): Skill | null {
    if (!NOMBRE_SKILL.test(nombre)) return null
    try {
      const nota = parsearNota(readFileSync(join(this.carpeta, nombre, 'SKILL.md'), 'utf8'), 'SKILL.md')
      return { nombre, descripcion: nota.descripcion, cuerpo: nota.cuerpo.slice(0, MAX_SKILL) }
    } catch {
      return null
    }
  }

  /** Crea o sustituye una skill; si ya existía, guarda antes una copia (`anterior-<fecha>.md`) junto a ella. */
  guardar(s: Skill, ahora = new Date()): { nueva: boolean } {
    if (!NOMBRE_SKILL.test(s.nombre)) throw new Error('Nombre de skill no válido (minúsculas, números y guiones).')
    const dir = join(this.carpeta, s.nombre)
    const ruta = join(dir, 'SKILL.md')
    mkdirSync(dir, { recursive: true })
    const nueva = !existsSync(ruta)
    if (!nueva) copyFileSync(ruta, join(dir, `anterior-${ahora.toISOString().replace(/[:.]/g, '-')}.md`))
    const texto = serializarNota({ nombre: s.nombre, descripcion: s.descripcion, tipo: 'skill', cuerpo: s.cuerpo, meta: { modified: ahora.toISOString() } })
    writeFileSync(`${ruta}.tmp`, texto, 'utf8')
    renameSync(`${ruta}.tmp`, ruta)
    return { nueva }
  }

  /** Lo que va en el prompt: solo nombre y para qué sirve; el texto se carga con `usar_skill` cuando hace falta. */
  indice(): string | undefined {
    const skills = this.listar()
    if (skills.length === 0) return undefined
    return [
      '## Skills del usuario',
      'Instrucciones que el usuario aprobó para tareas concretas. Si la tarea encaja con una, cárgala con usar_skill antes de empezar y síguela.',
      ...skills.map((s) => `- ${s.nombre}: ${s.descripcion}`)
    ].join('\n')
  }
}
