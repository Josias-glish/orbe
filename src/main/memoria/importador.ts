import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { InformeImportacion } from '../../shared/tipos'
import { AlmacenMemoria, huella, huellaContenido, type Recuerdo } from './almacen'
import { aSlug, parsearNota, tipoDeOrbe } from './formato'
import { buscarSensible } from './secretos'

const esCarpeta = (ruta: string): boolean => {
  try {
    return statSync(ruta).isDirectory()
  } catch {
    return false
  }
}

/** Las carpetas de memoria de Claude Code: `~/.claude/projects/<proyecto>/memory`, de todos los proyectos. */
export function carpetasClaudePorDefecto(inicio: string = homedir()): string[] {
  const raiz = join(inicio, '.claude', 'projects')
  let proyectos: string[]
  try {
    proyectos = readdirSync(raiz)
  } catch {
    return []
  }
  return proyectos.map((p) => join(raiz, p, 'memory')).filter(esCarpeta)
}

interface Candidata {
  clave: string
  archivo: string
  carpeta: string
  descripcion: string
  cuerpo: string
  tipoClaude: string
  modificado: string
  hashOrigen: string
}

/**
 * Trae a Orbe las notas de la memoria de Claude (solo lectura: no se toca nada de Claude).
 * - Los tipos user, feedback y project se importan; `reference` no, porque son apuntes para el propio
 *   Claude Code (trucos del entorno, enlaces) y no dicen nada del usuario.
 * - Una nota con claves o datos delicados se deja fuera.
 * - Es un solo sentido: si repites la importación se actualizan las notas que cambiaron en Claude, salvo
 *   las que hayas editado aquí o borrado a propósito.
 */
export function importarDeClaude(carpetas: string[], almacen: AlmacenMemoria, ahora: Date = new Date()): InformeImportacion {
  const informe: InformeImportacion = { nuevas: 0, actualizadas: 0, sinCambios: 0, omitidas: [], fuentes: 0 }
  const config = almacen.config()
  const candidatas = new Map<string, Candidata>()

  for (const carpeta of carpetas) {
    if (!esCarpeta(carpeta)) continue
    informe.fuentes++
    let archivos: string[]
    try {
      archivos = readdirSync(carpeta)
    } catch {
      continue
    }
    for (const archivo of archivos) {
      if (!archivo.toLowerCase().endsWith('.md') || archivo.toUpperCase() === 'MEMORY.MD') continue
      let texto: string
      try {
        texto = readFileSync(join(carpeta, archivo), 'utf8')
      } catch {
        informe.omitidas.push({ nombre: archivo, motivo: 'no se pudo leer' })
        continue
      }
      const nota = parsearNota(texto, archivo)
      const clave = aSlug(nota.nombre || archivo)
      const nueva: Candidata = {
        clave,
        archivo,
        carpeta,
        descripcion: nota.descripcion,
        cuerpo: nota.cuerpo,
        tipoClaude: nota.tipo,
        modificado: nota.meta['modified'] ?? '',
        hashOrigen: huella(texto)
      }
      // Si dos proyectos tienen una nota con el mismo nombre, gana la más reciente.
      const previa = candidatas.get(clave)
      if (!previa || nueva.modificado > previa.modificado) candidatas.set(clave, nueva)
    }
  }

  for (const c of candidatas.values()) {
    const nombre = c.archivo.replace(/\.md$/i, '')
    if (c.tipoClaude.toLowerCase() === 'reference') {
      informe.omitidas.push({ nombre, motivo: 'es una nota de referencia para Claude Code, no sobre ti' })
      continue
    }
    if (config.ignorados.includes(c.clave)) {
      informe.omitidas.push({ nombre, motivo: 'la borraste antes' })
      continue
    }
    const sensible = buscarSensible(`${c.descripcion}\n${c.cuerpo}`)
    if (sensible) {
      informe.omitidas.push({ nombre, motivo: `parece contener ${sensible}` })
      continue
    }

    const previo = config.importados[c.clave]
    const tipo = tipoDeOrbe(c.tipoClaude)
    const modificado = c.modificado || ahora.toISOString()

    if (!previo || !almacen.obtener(previo.id)) {
      // Nueva (o la tenía y desapareció el archivo sin pasar por «borrar»: se vuelve a traer).
      const id = previo?.id ?? almacen.idLibre(c.clave)
      const recuerdo: Recuerdo = {
        id,
        tipo,
        descripcion: c.descripcion,
        cuerpo: c.cuerpo,
        origen: 'claude',
        usar: true,
        // El perfil viaja entero; proyectos y preferencias, resumidos (se puede cambiar en el gestor).
        completo: tipo === 'usuario',
        modificado
      }
      almacen.guardar(recuerdo)
      config.importados[c.clave] = { id, hashOrigen: c.hashOrigen, hashContenido: huellaContenido(recuerdo) }
      informe.nuevas++
      continue
    }

    if (previo.hashOrigen === c.hashOrigen) {
      informe.sinCambios++
      continue
    }
    const local = almacen.obtener(previo.id)!
    if (huellaContenido(local) !== previo.hashContenido) {
      informe.omitidas.push({ nombre, motivo: 'la has editado aquí; no la piso con la de Claude' })
      continue
    }
    const actualizado: Recuerdo = { ...local, tipo, descripcion: c.descripcion, cuerpo: c.cuerpo, modificado }
    almacen.guardar(actualizado)
    config.importados[c.clave] = { id: previo.id, hashOrigen: c.hashOrigen, hashContenido: huellaContenido(actualizado) }
    informe.actualizadas++
  }

  almacen.guardarConfig(config)
  return informe
}
