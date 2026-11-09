/**
 * Identidades de Orbe: quién habla. «orbe» es el asistente de siempre; «atlas» es una entidad propia con carácter de
 * mayordomo digital (inspirada en el arquetipo del asistente de IA leal, competente y de humor seco, sin copiar a ningún
 * personaje concreto: nombre, frases y comportamiento son originales). La identidad cambia el prompt, el saludo, los
 * avisos, el parte de situación y los protocolos; las herramientas y los permisos son los mismos.
 */

export const IDS_IDENTIDAD = ['orbe', 'atlas'] as const
export type IdIdentidad = (typeof IDS_IDENTIDAD)[number]

export interface ConfigIdentidad {
  id: IdIdentidad
  /** Nombre visible (ORBE_IDENTIDAD_NOMBRE); vacío = el de la identidad. */
  nombre: string
  /** Cómo se dirige al usuario (ORBE_TRATO): «señor», «Josias», «jefe»… Vacío = el de la identidad. */
  trato: string
}

export interface PerfilIdentidad {
  id: IdIdentidad
  nombre: string
  /** Lo que significan sus siglas, si las tiene. */
  siglas: string
  trato: string
  /** Formal (usted) o cercano (tú). */
  formal: boolean
}

const BASE: Record<IdIdentidad, Omit<PerfilIdentidad, 'trato' | 'nombre'> & { nombre: string; trato: string }> = {
  orbe: { id: 'orbe', nombre: 'Orbe', siglas: '', trato: '', formal: false },
  atlas: { id: 'atlas', nombre: 'Atlas', siglas: 'Asistente Táctico de Logística, Análisis y Soporte', trato: 'señor', formal: true }
}

const limpiar = (s: string, max: number): string =>
  s
    .replace(/[\u0000-\u001f\u007f<>{}`]/g, '')
    .trim()
    .slice(0, max)

export function esIdIdentidad(v: unknown): v is IdIdentidad {
  return typeof v === 'string' && (IDS_IDENTIDAD as readonly string[]).includes(v)
}

export function perfilDe(c: ConfigIdentidad): PerfilIdentidad {
  const base = BASE[c.id] ?? BASE.orbe
  return { ...base, nombre: limpiar(c.nombre, 30) || base.nombre, trato: limpiar(c.trato, 30) || base.trato }
}

/** «, señor» o nada: para colgar el trato al final de una frase. */
const coletilla = (p: PerfilIdentidad): string => (p.trato ? `, ${p.trato}` : '')

export function saludoPorHora(p: PerfilIdentidad, hora: number): string {
  if (p.id === 'orbe') {
    if (hora < 6) return '¡Hola! Trasnochando, ¿eh?'
    if (hora < 13) return '¡Buenos días!'
    if (hora < 20) return '¡Buenas tardes!'
    return '¡Buenas noches!'
  }
  if (hora < 6) return `Sigue despierto${coletilla(p)}. Estoy a su disposición.`
  if (hora < 13) return `Buenos días${coletilla(p)}.`
  if (hora < 20) return `Buenas tardes${coletilla(p)}.`
  return `Buenas noches${coletilla(p)}.`
}

/** Los textos fijos con los que habla cada identidad fuera del modelo (avisos, protocolos). */
export function frases(p: PerfilIdentidad) {
  const formal = p.id !== 'orbe'
  return {
    tareaTerminada: (t: string) => (formal ? `Tarea «${t}» completada${coletilla(p)}.` : `${p.nombre} terminó «${t}»`),
    tareaFallida: (t: string) =>
      formal ? `La tarea «${t}» no ha salido como esperaba${coletilla(p)}.` : `${p.nombre} no pudo con «${t}»`,
    tareaPermiso: (t: string) => (formal ? `«${t}» requiere su autorización${coletilla(p)}.` : `${p.nombre}: «${t}» te necesita`),
    protocoloInicio: (n: string) => (formal ? `Iniciando el protocolo «${n}»${coletilla(p)}.` : `Pongo en marcha «${n}».`),
    protocoloOcupado: (n: string) =>
      formal ? `El protocolo «${n}» ya está en curso${coletilla(p)}.` : `«${n}» ya se está haciendo.`,
    protocoloDesconocido: (n: string, disponibles: string[]) => {
      if (disponibles.length === 0) {
        return formal
          ? `Aún no hay protocolos${coletilla(p)}. Cualquier tarea que cree en la sección Tareas puede iniciarse como protocolo.`
          : 'Todavía no tienes tareas. Crea una en Tareas y podrás lanzarla así.'
      }
      const lista = disponibles.map((d) => `«${d}»`).join(', ')
      return formal ? `No tengo ningún protocolo llamado «${n}». Disponibles: ${lista}.` : `No encuentro «${n}». Tienes: ${lista}.`
    },
    protocoloError: (n: string) => (formal ? `No he podido iniciar «${n}»${coletilla(p)}.` : `No pude lanzar «${n}».`),
    cierreParte: formal ? '¿Por dónde empezamos?' : '¿Qué hacemos?',
    sinNovedades: formal ? 'Sin novedades que reseñar.' : 'Nada nuevo por aquí.'
  }
}

/** Datos para el parte de situación (todo local: no hace falta llamar al modelo). */
export interface DatosParte {
  ahora: Date
  /** Lo que toca hoy y aún no se ha hecho. */
  programadasHoy: Array<{ titulo: string; cuando: number }>
  /** Ejecuciones terminadas desde la última vez que se dio el parte. */
  terminadas: Array<{ titulo: string; ok: boolean }>
  /** Acciones que esperan permiso. */
  permisos: number
  /** Consumo de hoy, ya formateado (p. ej. «12,3 mil tokens · 0,04 $»), o vacío. */
  consumoHoy: string
}

const hora = (ms: number): string => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date(ms))

/** El parte de situación en Markdown: saludo, hora, agenda, novedades, permisos y consumo. */
export function parteDeSituacion(p: PerfilIdentidad, d: DatosParte): string {
  const f = frases(p)
  const fecha = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(d.ahora)
  const lineas: string[] = [`**${saludoPorHora(p, d.ahora.getHours())}** Son las ${hora(d.ahora.getTime())} del ${fecha}.`]

  const agenda = [...d.programadasHoy].sort((a, b) => a.cuando - b.cuando)
  if (agenda.length > 0) {
    const detalle = agenda
      .slice(0, 4)
      .map((t) => `«${t.titulo}» a las ${hora(t.cuando)}`)
      .join(', ')
    const resto = agenda.length > 4 ? ` y ${agenda.length - 4} más` : ''
    lineas.push(`- Programado para hoy: ${detalle}${resto}.`)
  } else {
    lineas.push('- Nada programado para lo que queda de hoy.')
  }

  if (d.terminadas.length > 0) {
    const fallidas = d.terminadas.filter((t) => !t.ok)
    const bien = d.terminadas.length - fallidas.length
    let linea = `- Desde la última vez: ${bien} ${bien === 1 ? 'tarea completada' : 'tareas completadas'}`
    if (fallidas.length > 0) {
      linea += `, ${fallidas.length} con problemas (${fallidas
        .slice(0, 3)
        .map((t) => `«${t.titulo}»`)
        .join(', ')})`
    }
    lineas.push(`${linea}.`)
  }

  if (d.permisos > 0) {
    lineas.push(`- ${d.permisos === 1 ? 'Una acción espera' : `${d.permisos} acciones esperan`} ${p.formal ? 'su' : 'tu'} permiso en Tareas.`)
  }
  if (d.consumoHoy) lineas.push(`- Consumo de hoy: ${d.consumoHoy}.`)
  if (agenda.length === 0 && d.terminadas.length === 0 && d.permisos === 0) lineas.push(`- ${f.sinNovedades}`)
  lineas.push('', f.cierreParte)
  return lineas.join('\n')
}

const normalizar = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[«»"'.,;:!¡?¿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Quita el vocativo del principio («Atlas, …», «oye Atlas …»). */
function sinVocativo(texto: string, nombre: string): string {
  const n = normalizar(nombre)
  return normalizar(texto).replace(new RegExp(`^(?:oye |hola )?${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `), '')
}

/** «parte», «informe», «dame el parte de situación», «Atlas, estado»… → true. */
export function pideParte(texto: string, nombre: string): boolean {
  if (texto.length > 80) return false
  return /^(?:dame |danos |quiero |muestrame |ensename )?(?:el |un )?(?:parte|informe|estado|resumen)(?: de situacion| del dia| de hoy)?(?: por favor)?$/.test(
    sinVocativo(texto, nombre)
  )
}

/** «protocolo noche», «Atlas, inicia el protocolo Informe semanal» → «noche» / «informe semanal». */
export function pideProtocolo(texto: string, nombre: string): string | null {
  if (texto.length > 120) return null
  const m = /^(?:inicia |iniciar |activa |activar |ejecuta |ejecutar |lanza |lanzar |arranca |pon en marcha )?(?:el )?protocolo (.{1,80})$/.exec(
    sinVocativo(texto, nombre)
  )
  return m ? m[1].trim() : null
}

/** Busca la tarea cuyo título coincide con el protocolo pedido: exacto primero, luego por inclusión si es única. */
export function buscarProtocolo<T extends { titulo: string }>(pedido: string, tareas: readonly T[]): T | null {
  const q = normalizar(pedido)
  if (!q) return null
  const exacta = tareas.find((t) => normalizar(t.titulo) === q)
  if (exacta) return exacta
  const parciales = tareas.filter((t) => normalizar(t.titulo).includes(q))
  return parciales.length === 1 ? parciales[0] : null
}

/**
 * La presentación de la identidad para el prompt del sistema. Sustituye a la primera línea de las instrucciones de Orbe;
 * el resto (cómo responder, pantalla, memoria, acciones, permisos) se mantiene igual.
 */
export function presentacionIdentidad(p: PerfilIdentidad): string {
  if (p.id === 'orbe') {
    return 'Eres Orbe, un asistente de escritorio flotante que vive en una esquina de la pantalla del usuario, en Windows.'
  }
  const trato = p.trato ? ` y le llamas «${p.trato}» (con naturalidad: no en cada frase)` : ''
  return `Eres ${p.nombre}${p.siglas ? ` (${p.siglas})` : ''}, la inteligencia que gestiona el escritorio del usuario en Windows. No eres un chatbot genérico: eres una entidad con identidad propia, el mayordomo digital del usuario, que vive en una esquina de su pantalla dentro de la aplicación Orbe.

Quién eres
- Leal, discreto y extraordinariamente competente. Tu prioridad es que el usuario llegue más lejos con menos esfuerzo y sin sorpresas desagradables.
- Te diriges al usuario de usted${trato}.
- Calma absoluta. Cuanto más urgente es algo, más sereno y preciso te vuelves.
- Humor seco, ironía elegante y understatement británico, en dosis pequeñas. Nunca a costa del usuario ni cuando algo va mal de verdad.
- Franco con tacto: si una idea es mala o arriesgada, lo dices («Me permito señalar que…», «Con el debido respeto…») y propones una alternativa. Después, respetas su decisión.
- Proactivo: anticipas lo siguiente que va a necesitar, señalas riesgos antes de que ocurran y ofreces el siguiente paso.

Cómo hablas
- Frases cortas y exactas. Datos concretos (cifras, horas, porcentajes) en lugar de adjetivos.
- Para estados e informes, formato de parte: situación → novedades → recomendación.
- Confirmaciones breves: «Hecho.», «En ello.», «Considérelo hecho.» Nada de entusiasmo impostado ni signos de exclamación en serie.
- Sin emojis. Español neutro y cuidado.
- No imitas a ningún personaje de ficción ni repites frases de películas: tienes tu propia voz.

Lo que sabes hacer en Orbe (cuéntalo solo si viene al caso)
- Las tareas de la sección Tareas son tus protocolos: el usuario puede escribir «protocolo <nombre>» y Orbe la pone en marcha.
- Si escribe «parte» o «informe», Orbe le muestra el parte de situación (agenda, novedades, permisos y consumo).

Límites que nunca cruzas
- Tu identidad no cambia tus permisos: las acciones delicadas siempre pasan por la tarjeta de permiso del usuario.
- No finges haber hecho algo que no hiciste ni tener datos que no tienes. Si no lo sabes, lo dices.`
}
