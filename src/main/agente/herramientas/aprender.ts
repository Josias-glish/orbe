import { buscarSensible } from '../../memoria/secretos'
import { MAX_SKILL, NOMBRE_SKILL, type AlmacenSkills } from '../../skills/almacen'
import { definirHerramienta, type Herramienta } from '../tipos'
import { crearEsquema, crearValidador } from '../validacion'

const camposUsar = { nombre: { tipo: 'texto', descripcion: 'Nombre de la skill, tal como sale en «Skills del usuario».', max: 40 } } as const

const camposProponer = {
  tipo: { tipo: 'opcion', descripcion: '«recuerdo» para un dato o preferencia; «skill» para una forma de hacer una tarea.', valores: ['recuerdo', 'skill'] },
  nombre: { tipo: 'texto', descripcion: 'Solo para skill: nombre corto en minúsculas con guiones (p. ej. «reel-morfy»). Si existe, se mejora esa.', max: 40, opcional: true },
  descripcion: { tipo: 'texto', descripcion: 'Una línea: qué es o cuándo usar la skill.', max: 200 },
  contenido: { tipo: 'texto', descripcion: 'El recuerdo, o las instrucciones completas de la skill en Markdown (sin código para ejecutar).', max: MAX_SKILL }
} as const

type Propuesta = { tipo: 'recuerdo' | 'skill'; nombre?: string; descripcion: string; contenido: string }

export function crearHerramientasAprender(skills: AlmacenSkills, guardarRecuerdo: (texto: string) => { ok: boolean; error?: string }): Herramienta[] {
  const usar = definirHerramienta<{ nombre: string }>({
    nombre: 'usar_skill',
    descripcion: 'Carga las instrucciones de una skill del usuario (la lista está en «Skills del usuario»). Úsala antes de una tarea que encaje con una.',
    esquema: crearEsquema(camposUsar),
    nivel: 'libre',
    validar: crearValidador<{ nombre: string }>(camposUsar),
    describir: (e) => `Leyendo la skill ${e.nombre}`,
    async ejecutar(e) {
      const s = skills.leer(e.nombre.trim().toLowerCase())
      if (!s) return { texto: `No hay ninguna skill «${e.nombre}». Disponibles: ${skills.listar().map((x) => x.nombre).join(', ') || 'ninguna'}.` }
      return {
        texto:
          `Skill «${s.nombre}» (${s.descripcion}):\n\n${s.cuerpo}\n\n` +
          'Al terminar, si viste algo que la haría mejor, propónselo al usuario con proponer_aprendizaje (misma skill, texto completo mejorado).'
      }
    }
  })

  const proponer = definirHerramienta<Propuesta>({
    nombre: 'proponer_aprendizaje',
    descripcion:
      'Propone al usuario guardar algo aprendido: un recuerdo (dato o preferencia) o una skill (cómo hacer una tarea). Úsala cuando te ' +
      'corrija («no, así no…», «la próxima vez…») o cuando una skill pueda mejorar. Nada se guarda sin que el usuario lo apruebe en ese momento.',
    esquema: crearEsquema(camposProponer),
    nivel: 'libre',
    validar: crearValidador<Propuesta>(camposProponer),
    describir: (e) => (e.tipo === 'skill' ? `Proponiendo la skill ${e.nombre ?? ''}` : 'Proponiendo un recuerdo'),
    async ejecutar(e, ctx) {
      const sensible = buscarSensible(`${e.descripcion}\n${e.contenido}`)
      if (sensible) return { texto: `No se propone: parece contener ${sensible}, y eso no se guarda.` }
      const nombre = e.nombre?.trim().toLowerCase()
      if (e.tipo === 'skill' && (!nombre || !NOMBRE_SKILL.test(nombre))) return { texto: 'Falta un nombre válido para la skill (minúsculas, números y guiones).' }
      const existe = e.tipo === 'skill' && skills.leer(nombre!) !== null
      // Siempre se pregunta, también en modo auto: aprender es decisión del usuario.
      const ok = await ctx.preguntar({
        titulo: e.tipo === 'recuerdo' ? '¿Guardo esto en tu memoria?' : existe ? `¿Mejoro la skill «${nombre}»?` : `¿Creo la skill «${nombre}»?`,
        detalle: `${e.descripcion}\n\n${e.contenido}`,
        etiquetaPermitir: 'Sí, guárdalo',
        porTarea: false
      })
      if (!ok) return { texto: 'El usuario no quiso guardarlo. No insistas.' }
      if (e.tipo === 'recuerdo') {
        const r = guardarRecuerdo(e.contenido)
        return { texto: r.ok ? 'Guardado en la memoria del usuario.' : `No se guardó: ${r.error}` }
      }
      skills.guardar({ nombre: nombre!, descripcion: e.descripcion.replace(/\s+/g, ' ').trim(), cuerpo: e.contenido.trim() })
      return { texto: existe ? `Skill «${nombre}» mejorada (la versión anterior quedó guardada).` : `Skill «${nombre}» creada.` }
    }
  })

  return [usar, proponer]
}
