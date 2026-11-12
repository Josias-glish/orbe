import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export const ID_LATIDO = 'orbe-latido'

const PLANTILLA = `<!--
PROACTIVO.md: lo que Orbe revisa por su cuenta cada ORBE_PROACTIVO_MIN minutos (en el .env).
Escribe debajo, en frases normales, qué quieres que vigile o haga. Mientras este archivo solo tenga este comentario,
Orbe no llama al modelo y no gasta nada.

Ejemplo:
- Si hay correos de clientes sin responder desde hace más de un día, avísame con un resumen.
- Si una publicación de morfy de hoy va muy por debajo de la media, dímelo.
-->
`

/** Crea PROACTIVO.md con la ayuda (vacío de órdenes) si no existe; nunca toca uno que ya existe. */
export function asegurarProactivo(ruta: string): void {
  if (!existsSync(ruta)) writeFileSync(ruta, PLANTILLA, 'utf8')
}

/** Lo que pide PROACTIVO.md sin los comentarios; null si no pide nada (así el latido no gasta). */
export function leerProactivo(ruta: string): string | null {
  try {
    const texto = readFileSync(ruta, 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim()
    return texto ? texto.slice(0, 4000) : null
  } catch {
    return null
  }
}
