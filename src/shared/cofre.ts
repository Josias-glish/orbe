/**
 * Los secretos que Orbe sabe guardar en el cofre cifrado. Es una lista cerrada: la interfaz solo puede escribir en
 * estas claves (nunca en una clave inventada) y no hay ningún canal para leer un valor de vuelta.
 */

/** `texto`: se guarda tal cual. `token_ig`: se guarda con la fecha, para saber cuándo renovarlo (cada 30 días). */
export type FormaSecreto = 'texto' | 'token_ig'

export interface DefinicionSecreto {
  clave: string
  nombre: string
  ayuda: string
  /** `false`: lo guarda Orbe solo (p. ej. al conectar Gmail); en Ajustes solo se ve si existe y se puede revocar. */
  manual: boolean
  forma: FormaSecreto
  /** Grupo en la pantalla de Conectores. */
  servicio: 'Instagram' | 'Meta' | 'Supabase' | 'Gmail' | 'Composio' | 'Visión'
}

export const SECRETOS: readonly DefinicionSecreto[] = [
  {
    clave: 'ig.morfy',
    nombre: 'Token de morfy',
    ayuda: 'Meta Developers → tu app → API con inicio de sesión de Instagram → Generar identificadores de acceso, iniciando sesión con la cuenta de morfy (guía 01, paso 4).',
    manual: true,
    forma: 'token_ig',
    servicio: 'Instagram'
  },
  {
    clave: 'ig.personal',
    nombre: 'Token de tu marca personal',
    ayuda: 'Solo si tu marca personal tiene su propia cuenta profesional de Instagram.',
    manual: true,
    forma: 'token_ig',
    servicio: 'Instagram'
  },
  {
    clave: 'ig.app_secret',
    nombre: 'Clave secreta de la app de Instagram',
    ayuda: 'Configuración de la API con inicio de sesión de Instagram → clave secreta de la app (guía 01, paso 2).',
    manual: true,
    forma: 'texto',
    servicio: 'Meta'
  },
  {
    clave: 'supabase.secret',
    nombre: 'Clave secreta de Supabase',
    ayuda: 'Project Settings → API Keys → Secret keys. Empieza por «sb_secret_» (guía 03, paso 3).',
    manual: true,
    forma: 'texto',
    servicio: 'Supabase'
  },
  {
    clave: 'gmail.refresh',
    nombre: 'Acceso a Gmail',
    ayuda: 'Solo leer y crear borradores (Orbe no puede enviar). Antes, guarda google-cliente.json en la carpeta de datos de Orbe (guía 02, paso 3).',
    manual: false,
    forma: 'texto',
    servicio: 'Gmail'
  },
  {
    clave: 'composio.clave',
    nombre: 'Clave de Composio',
    ayuda: 'dashboard.composio.dev → AI Clients → copia la clave «consumer» (la que va en x-consumer-api-key). Cada app se conecta después desde el chat, en tu navegador.',
    manual: true,
    forma: 'texto',
    servicio: 'Composio'
  },
  {
    clave: 'vision.clave',
    nombre: 'Clave de visión',
    ayuda: 'Solo si VISION_PROVIDER es anthropic, openai, gemini u openrouter. Con claude-cli u ollama no hace falta.',
    manual: true,
    forma: 'texto',
    servicio: 'Visión'
  }
]

export function definicionSecreto(clave: unknown): DefinicionSecreto | undefined {
  return typeof clave === 'string' ? SECRETOS.find((s) => s.clave === clave) : undefined
}

/** Lo único que la interfaz sabe del cofre: si funciona y qué claves tienen algo guardado. Nunca valores. */
export interface EstadoCofre {
  disponible: boolean
  error?: string
  guardados: Record<string, boolean>
}

export type ResultadoCofre = { ok: true; estado: EstadoCofre } | { ok: false; error: string; estado: EstadoCofre }
