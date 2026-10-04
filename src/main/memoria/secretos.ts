/**
 * Detección de claves y datos personales delicados. La memoria viaja a Claude en cada conversación y se
 * guarda en claro en una carpeta: ahí no deben acabar contraseñas, claves de API ni números de tarjeta.
 * Es una red de seguridad prudente, no un antivirus: prefiere avisar de más que de menos.
 */

interface Patron {
  motivo: string
  re: RegExp
}

const PATRONES: Patron[] = [
  { motivo: 'una clave de API', re: /\bsk-ant-[\w-]{16,}/i },
  { motivo: 'una clave de API', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { motivo: 'una clave secreta', re: /\bsb_secret_[A-Za-z0-9_-]{8,}/i },
  { motivo: 'un token de GitHub', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { motivo: 'un token de GitHub', re: /\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  { motivo: 'una clave de AWS', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { motivo: 'una clave de Google', re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { motivo: 'un token de Slack', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { motivo: 'un token de sesión (JWT)', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { motivo: 'una clave privada', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { motivo: 'un token de acceso', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/ },
  { motivo: 'una dirección con usuario y contraseña', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i },
  { motivo: 'un número de la seguridad social', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { motivo: 'un documento de identidad', re: /\b\d{8}[- ]?[A-HJ-NP-TV-Z]\b/i },
  { motivo: 'un documento de identidad', re: /\b[XYZ][- ]?\d{7}[- ]?[A-Z]\b/i },
  // Un token aleatorio largo: solo letras y números, con mayúsculas, minúsculas y dígitos. Los nombres con guiones
  // (como «pasted-content-id-7162-rol-gleaming-whale»), los UUID y los hash hexadecimales no entran aquí.
  {
    motivo: 'una cadena que parece una clave',
    re: /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*[A-Z])[A-Za-z0-9]{32,}\b/
  }
]

/** «mi contraseña es X», «password: X», «PIN = 1234»… */
const FRASE_CLAVE =
  /\b(?:contrase[ñn]a|password|passwd|pwd|clave\s+(?:de\s+)?(?:acceso|secreta|privada|api|wifi)|api[\s_-]?key|secret(?:o)?|token|pin|cvv|cvc)\b[^\n.]{0,20}?(?:\bes\b|\bera\b|\bson\b|:|=|->)\s*["'«]?([^\s"'»]{4,})/gi

/** Palabras que siguen a «contraseña es…» en una frase normal y no son una clave. */
const NO_ES_CLAVE = new Set([
  'importante',
  'segura',
  'seguro',
  'larga',
  'corta',
  'secreta',
  'secreto',
  'dificil',
  'difícil',
  'facil',
  'fácil',
  'fuerte',
  'debil',
  'débil',
  'obligatoria',
  'obligatorio',
  'opcional',
  'distinta',
  'diferente',
  'unica',
  'única',
  'nueva',
  'vieja',
  'igual',
  'personal',
  'privada',
  'privado',
  'necesaria',
  'necesario',
  'requerida',
  'valida',
  'válida'
])

function pasaLuhn(digitos: string): boolean {
  let suma = 0
  let doble = false
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = digitos.charCodeAt(i) - 48
    if (doble) {
      d *= 2
      if (d > 9) d -= 9
    }
    suma += d
    doble = !doble
  }
  return suma % 10 === 0
}

function hayTarjeta(texto: string): boolean {
  for (const m of texto.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digitos = m[0].replace(/\D/g, '')
    if (digitos.length >= 13 && digitos.length <= 19 && pasaLuhn(digitos)) return true
  }
  return false
}

function hayIban(texto: string): boolean {
  for (const m of texto.matchAll(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b/g)) {
    const compacto = m[0].replace(/\s/g, '')
    if (compacto.length >= 15 && compacto.length <= 34) return true
  }
  return false
}

/** Si el texto parece contener algo que no debe guardarse, dice qué (en lenguaje llano); si no, null. */
export function buscarSensible(texto: string): string | null {
  for (const { motivo, re } of PATRONES) {
    if (re.test(texto)) return motivo
  }
  for (const m of texto.matchAll(FRASE_CLAVE)) {
    if (!NO_ES_CLAVE.has(m[1].toLowerCase().replace(/[.,;:!?]+$/, ''))) return 'una contraseña o una clave'
  }
  if (hayTarjeta(texto)) return 'un número de tarjeta'
  if (hayIban(texto)) return 'un número de cuenta bancaria'
  return null
}
