import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Notas de mentira con el formato de la memoria de Claude, para la prueba visual (--smoke): así la prueba
 * nunca lee ni enseña la memoria real del usuario. Devuelve la carpeta que hay que usar como origen.
 */
export function prepararMemoriaDeMentira(base: string): string[] {
  const carpeta = join(base, 'orbe-humo-memoria-claude')
  rmSync(carpeta, { recursive: true, force: true })
  mkdirSync(carpeta, { recursive: true })

  const nota = (archivo: string, tipo: string, descripcion: string, cuerpo: string): void => {
    writeFileSync(
      join(carpeta, archivo),
      `---\nname: ${archivo.replace(/\.md$/, '')}\ndescription: ${JSON.stringify(descripcion)}\nmetadata:\n  node_type: memory\n  type: ${tipo}\n  modified: 2026-10-03T19:12:15.936Z\n---\n\n${cuerpo}\n`,
      'utf8'
    )
  }

  nota(
    'user-perfil-demo.md',
    'user',
    'Quién es el usuario (demo): estudiante que aprende a programar; le gustan la astronomía, los videojuegos de aventura y la cocina casera',
    'Persona de ejemplo para la prueba visual. Estudia por las tardes, escribe en español y le encantan los documentales de espacio.\n\n**How to apply:** responde en español, directo y con ejemplos cortos. Ver [[preferencias-demo]].'
  )
  nota(
    'proyecto-huerto-demo.md',
    'project',
    'Huerto urbano en el balcón (demo): tomates y albahaca, riego cada mañana',
    'Detalles del huerto de ejemplo: tres macetas grandes, sol de tarde, abono casero. Este texto largo solo viaja si se marca «completo».'
  )
  nota('preferencias-demo.md', 'feedback', 'Prefiere explicaciones breves y con un ejemplo (demo)', 'Si la respuesta es larga, empieza por un resumen de una línea.')
  nota('referencia-demo.md', 'reference', 'Truco de la terminal (demo): no habla del usuario', 'Un apunte técnico para Claude Code que no debe importarse.')
  // La clave de mentira se arma en tiempo de ejecución para no dejar nada con aspecto de clave real en el código.
  nota('clave-demo.md', 'project', 'Servicio de ejemplo (demo)', `Acceso de prueba: ${'sk-ant-' + 'api03-'}${'A1b2'.repeat(10)}`)
  writeFileSync(join(carpeta, 'MEMORY.md'), '- [Perfil](user-perfil-demo.md) — índice que no se importa\n', 'utf8')
  return [carpeta]
}
