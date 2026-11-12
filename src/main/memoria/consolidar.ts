import type { PropuestaLimpieza } from '../../shared/tipos'
import type { Recuerdo } from './almacen'

/** Días sin usarse ni editarse tras los que un recuerdo pierde peso (solo viaja su resumen) y se propone archivarlo. */
export const DIAS_CADUCA = 90
const DIA = 86_400_000

/** Fecha de referencia de un recuerdo: la última vez que se usó o se editó, lo más reciente. */
const referencia = (r: Recuerdo, ultimoUso: string | null): number =>
  Math.max(Date.parse(r.modificado) || 0, ultimoUso ? Date.parse(ultimoUso) || 0 : 0)

export function caducado(r: Recuerdo, ultimoUso: string | null, ahora: Date, dias = DIAS_CADUCA): boolean {
  return ahora.getTime() - referencia(r, ultimoUso) > dias * DIA
}

const normalizar = (t: string): string =>
  t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Mismo contenido dicho casi igual: idéntico al normalizar, uno contiene al otro, o comparten casi todas las palabras. */
export function sonDuplicados(a: string, b: string): boolean {
  const x = normalizar(a)
  const y = normalizar(b)
  if (!x || !y) return false
  if (x === y) return true
  if (Math.min(x.length, y.length) >= 20 && (x.includes(y) || y.includes(x))) return true
  const px = new Set(x.split(' '))
  const py = new Set(y.split(' '))
  if (px.size < 4 || py.size < 4) return false
  const comunes = [...px].filter((p) => py.has(p)).length
  return comunes / (px.size + py.size - comunes) >= 0.8
}

/**
 * La consolidación (M6): propone archivar los duplicados (se queda el más completo) y lo que lleva meses sin usarse.
 * Solo propone: nada se toca hasta que el usuario lo acepta, y lo que descarta no se vuelve a proponer.
 */
export function proponerLimpieza(
  recuerdos: readonly Recuerdo[],
  ultimoUso: (id: string) => string | null,
  ahora: Date,
  descartadas: ReadonlySet<string>
): PropuestaLimpieza[] {
  const propuestas: PropuestaLimpieza[] = []
  const archivados = new Set<string>()
  for (let i = 0; i < recuerdos.length; i++) {
    for (let j = i + 1; j < recuerdos.length; j++) {
      const a = recuerdos[i]!
      const b = recuerdos[j]!
      if (archivados.has(a.id) || archivados.has(b.id) || !sonDuplicados(a.cuerpo, b.cuerpo)) continue
      // Se conserva el más largo; a igual longitud, el más reciente.
      const [conservar, sobra] =
        a.cuerpo.length !== b.cuerpo.length ? (a.cuerpo.length > b.cuerpo.length ? [a, b] : [b, a]) : a.modificado >= b.modificado ? [a, b] : [b, a]
      const id = `dup:${sobra.id}:${conservar.id}`
      if (descartadas.has(id)) continue
      archivados.add(sobra.id)
      propuestas.push({ id, tipo: 'duplicado', archivar: sobra.id, titulo: sobra.descripcion, motivo: `Repite lo que dice «${conservar.descripcion}».` })
    }
  }
  for (const r of recuerdos) {
    const id = `cad:${r.id}`
    if (archivados.has(r.id) || descartadas.has(id) || !caducado(r, ultimoUso(r.id), ahora)) continue
    const dias = Math.floor((ahora.getTime() - referencia(r, ultimoUso(r.id))) / DIA)
    propuestas.push({ id, tipo: 'caducado', archivar: r.id, titulo: r.descripcion, motivo: `Lleva ${dias} días sin usarse ni editarse.` })
  }
  return propuestas
}
