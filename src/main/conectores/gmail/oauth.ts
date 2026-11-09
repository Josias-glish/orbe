import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'

/**
 * OAuth de Google para aplicaciones de escritorio: el navegador del sistema, vuelta por 127.0.0.1 en un puerto libre y
 * PKCE (https://developers.google.com/identity/protocols/oauth2/native-app). Solo se piden dos permisos: leer y crear
 * borradores. Orbe no pide `gmail.send` ni `gmail.modify`: aunque el modelo quisiera, Google no le dejaría enviar.
 */
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
const REVOCAR = 'https://oauth2.googleapis.com/revoke'
export const PERMISOS_GMAIL = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose']

export interface ClienteGoogle {
  client_id: string
  client_secret: string
}

export interface DepsOAuth {
  /** Abre la dirección en el navegador del usuario (en Orbe, `shell.openExternal`). */
  abrir(url: string): void | Promise<void>
  fetch?: typeof fetch
  /** Cuánto se espera a que el usuario termine en el navegador. */
  esperaMs?: number
  /** Para dejar de esperar (si Google da un error en el navegador, nunca vuelve a Orbe). */
  senal?: AbortSignal
}

/** Lee el `google-cliente.json` que se descarga de Google Cloud (cliente de tipo «App de escritorio»). */
export function leerClienteGoogle(ruta: string): ClienteGoogle {
  let datos: unknown
  try {
    datos = JSON.parse(readFileSync(ruta, 'utf8').replace(/^﻿/, ''))
  } catch {
    throw new Error('No encuentro google-cliente.json en la carpeta de datos de Orbe (o no es un JSON válido). Sigue la guía de Google, paso 3.')
  }
  const c = (datos as { installed?: Partial<ClienteGoogle> } | null)?.installed
  if (typeof c?.client_id !== 'string' || typeof c.client_secret !== 'string') {
    throw new Error('google-cliente.json no es de un cliente de tipo «App de escritorio». Créalo de ese tipo y descárgalo otra vez.')
  }
  return { client_id: c.client_id, client_secret: c.client_secret }
}

const pagina = (texto: string): string => `<!doctype html><meta charset="utf-8"><title>Orbe</title><p style="font:16px system-ui;margin:3em">${texto}</p>`

/** Abre el navegador, espera la vuelta en 127.0.0.1 y devuelve el permiso duradero (que va directo al cofre). */
export async function conectarGmail(cliente: ClienteGoogle, deps: DepsOAuth): Promise<string> {
  const pedir = deps.fetch ?? fetch
  const verificador = randomBytes(32).toString('base64url')
  const reto = createHash('sha256').update(verificador).digest('base64url')
  const estado = randomBytes(16).toString('hex')

  const { codigo, redirect } = await new Promise<{ codigo: string; redirect: string }>((resolver, rechazar) => {
    let redirect = ''
    const servidor = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      // Lo que no traiga nuestro `state` (el favicon, otra pestaña, otro programa) se ignora y se sigue esperando.
      if (url.searchParams.get('state') !== estado) {
        res.statusCode = 400
        res.end(pagina('Esta página no viene de la conexión que Orbe está esperando.'))
        return
      }
      const codigo = url.searchParams.get('code')
      res.end(pagina(codigo ? 'Listo. Ya puedes volver a Orbe.' : 'No se dio el permiso. Puedes cerrar esta pestaña.'))
      terminar()
      if (codigo) resolver({ codigo, redirect })
      else rechazar(new Error(url.searchParams.get('error') === 'access_denied' ? 'Cancelaste el permiso en Google.' : 'Google no dio el permiso.'))
    })
    const reloj = setTimeout(() => {
      terminar()
      rechazar(new Error('Se acabó el tiempo de espera. Pulsa «Conectar» otra vez.'))
    }, deps.esperaMs ?? 5 * 60_000)
    const terminar = (): void => {
      clearTimeout(reloj)
      servidor.close()
    }
    deps.senal?.addEventListener(
      'abort',
      () => {
        terminar()
        rechazar(new Error('Conexión cancelada.'))
      },
      { once: true }
    )
    servidor.once('error', (e) => {
      clearTimeout(reloj)
      rechazar(e)
    })
    servidor.listen(0, '127.0.0.1', () => {
      redirect = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`
      const p = new URLSearchParams({
        client_id: cliente.client_id,
        redirect_uri: redirect,
        response_type: 'code',
        scope: PERMISOS_GMAIL.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        code_challenge: reto,
        code_challenge_method: 'S256',
        state: estado
      })
      Promise.resolve(deps.abrir(`${AUTH}?${p}`)).catch(() => {
        terminar()
        rechazar(new Error('No he podido abrir el navegador.'))
      })
    })
  })

  const r = await pedir(TOKEN, {
    method: 'POST',
    body: new URLSearchParams({
      code: codigo,
      client_id: cliente.client_id,
      client_secret: cliente.client_secret,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
      code_verifier: verificador
    })
  })
  const j = (await r.json().catch(() => ({}))) as { refresh_token?: string; scope?: string; error?: string }
  if (!j.refresh_token) throw new Error(`Google no devolvió el permiso (${j.error ?? r.status}).`)
  // Si en la pantalla de Google se desmarcó una casilla, mejor decirlo ahora que fallar después a medias.
  const dados = (j.scope ?? '').split(' ')
  if (j.scope && !PERMISOS_GMAIL.every((p) => dados.includes(p))) {
    throw new Error('Faltó marcar alguno de los dos permisos (leer y crear borradores). Pulsa «Conectar» y marca los dos.')
  }
  return j.refresh_token
}

/**
 * Da un token de acceso válido (dura ~1 h) a partir del permiso guardado, y lo reutiliza hasta un minuto antes de que
 * caduque. `leerPermiso` se consulta cada vez: así conectar o revocar desde Ajustes vale sin reiniciar.
 */
export function crearFuenteDeToken(
  cliente: () => ClienteGoogle,
  leerPermiso: () => string | undefined,
  pedir: typeof fetch = fetch,
  ahora: () => number = Date.now
): () => Promise<string> {
  let guardado: { token: string; caduca: number; permiso: string } | null = null
  return async () => {
    const permiso = leerPermiso()
    if (!permiso) throw new Error('Gmail no está conectado. Conéctalo en Configuración → Conectores → Gmail.')
    if (guardado && guardado.permiso === permiso && ahora() < guardado.caduca) return guardado.token
    const c = cliente()
    const r = await pedir(TOKEN, {
      method: 'POST',
      body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: permiso, grant_type: 'refresh_token' })
    })
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string }
    if (!j.access_token) {
      throw new Error(
        j.error === 'invalid_grant'
          ? 'El permiso de Gmail caducó o se revocó: vuelve a conectar en Configuración → Conectores.'
          : `Google no dio acceso (${j.error ?? r.status}).`
      )
    }
    guardado = { token: j.access_token, caduca: ahora() + ((j.expires_in ?? 3600) - 60) * 1000, permiso }
    return guardado.token
  }
}

/** Avisa a Google de que el permiso ya no vale. Es un extra: si falla, el permiso igualmente se borra del cofre. */
export async function revocarEnGoogle(permiso: string, pedir: typeof fetch = fetch): Promise<void> {
  try {
    await pedir(REVOCAR, { method: 'POST', body: new URLSearchParams({ token: permiso }) })
  } catch {
    // sin conexión: el usuario puede revocarlo en https://myaccount.google.com/permissions
  }
}
