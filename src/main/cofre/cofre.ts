import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

type Secretos = Record<string, unknown>

/**
 * Quién cifra. En Orbe es `safeStorage` de Electron (DPAPI en Windows: ligado a tu usuario de Windows); en las pruebas,
 * uno de mentira. Así el cofre se puede probar sin Electron.
 */
export interface Cifrador {
  disponible(): boolean
  cifrar(texto: string): Buffer
  descifrar(datos: Buffer): string
}

/** Secretos más cortos que esto no se tachan de los textos: tacharían palabras normales. */
const LARGO_MIN_TACHAR = 8
export const TACHADO = '[secreto]'

/**
 * Secretos cifrados en `cofre.bin`. Nunca pasan a la interfaz, a los registros ni al modelo: solo los leen los
 * conectores del proceso principal. Si el archivo existe pero no se puede abrir (otro usuario de Windows, archivo
 * dañado), el cofre se niega a escribir encima: perder un token es peor que no poder guardar uno nuevo.
 */
export class Cofre {
  private datos: Secretos | null = null

  constructor(
    private readonly ruta: string,
    private readonly cifrador: Cifrador
  ) {}

  private cargar(): Secretos {
    if (this.datos) return this.datos
    if (!this.cifrador.disponible()) throw new Error('El cifrado de Windows no está disponible en este equipo.')
    if (!existsSync(this.ruta)) {
      this.datos = {}
      return this.datos
    }
    let leido: unknown
    try {
      leido = JSON.parse(this.cifrador.descifrar(readFileSync(this.ruta)))
    } catch {
      throw new Error('No he podido abrir el cofre (cofre.bin). No lo he tocado.')
    }
    const secretos = (leido as { secretos?: unknown } | null)?.secretos
    if (typeof secretos !== 'object' || secretos === null || Array.isArray(secretos)) {
      throw new Error('El cofre (cofre.bin) tiene un formato que no reconozco. No lo he tocado.')
    }
    this.datos = secretos as Secretos
    return this.datos
  }

  leer<T = string>(clave: string): T | undefined {
    return this.cargar()[clave] as T | undefined
  }

  guardar(clave: string, valor: unknown): void {
    this.escribir({ ...this.cargar(), [clave]: valor })
  }

  borrar(clave: string): void {
    const actuales = this.cargar()
    if (!(clave in actuales)) return
    const { [clave]: _fuera, ...resto } = actuales
    this.escribir(resto)
  }

  private escribir(datos: Secretos): void {
    const cifrado = this.cifrador.cifrar(JSON.stringify({ version: 1, secretos: datos }))
    // Escritura atómica: si Orbe se cierra a medias, queda el cofre anterior entero, nunca uno roto.
    writeFileSync(this.ruta + '.tmp', cifrado, { mode: 0o600 })
    renameSync(this.ruta + '.tmp', this.ruta)
    this.datos = datos
  }

  /** Para la interfaz: solo qué claves tienen algo, nunca el valor. */
  estado(): Record<string, boolean> {
    return Object.fromEntries(Object.keys(this.cargar()).map((k) => [k, true]))
  }

  /**
   * Sustituye cualquier secreto guardado que aparezca en un texto por «[secreto]». Es la última red antes de enseñar
   * o guardar algo (avisos de Actividad, errores): si el cofre no se puede abrir, devuelve el texto tal cual.
   */
  tachar(texto: string): string {
    let valores: string[]
    try {
      valores = cadenasDe(this.cargar())
    } catch {
      return texto
    }
    let salida = texto
    for (const v of valores.sort((a, b) => b.length - a.length)) {
      if (v.length >= LARGO_MIN_TACHAR) salida = salida.split(v).join(TACHADO)
    }
    return salida
  }
}

/** Todas las cadenas que hay dentro de un valor (un token suelto o un objeto `{ token, renovado }`). */
function cadenasDe(valor: unknown): string[] {
  if (typeof valor === 'string') return [valor]
  if (Array.isArray(valor)) return valor.flatMap(cadenasDe)
  if (typeof valor === 'object' && valor !== null) {
    // La fecha de renovación no es secreta: tacharla estropearía cualquier texto con esa fecha.
    return Object.entries(valor)
      .filter(([k]) => k !== 'renovado')
      .flatMap(([, v]) => cadenasDe(v))
  }
  return []
}
