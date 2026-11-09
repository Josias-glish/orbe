#!/usr/bin/env node
// Manda un aviso a Orbe (el asistente de escritorio) para que su personaje lo muestre.
//
// Como hook de Claude Code (lee el JSON del hook por la entrada estándar):
//   node orbe-evento.mjs --claude-code
// Desde cualquier script o herramienta:
//   node orbe-evento.mjs --titulo "Copia de seguridad lista" --tipo terminado --origen backup [--detalle "…"]
//   tipos: inicio, trabajando, esperando, terminado, error, info
//
// Lee el puerto y el token de %APPDATA%\orbe\conectores.json (lo crea Orbe con ORBE_EVENTOS=1).
// Nunca escribe nada en la salida ni falla: si Orbe no está abierto, no pasa nada y Claude Code sigue igual.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const TIEMPO_MS = 1500

function carpetaDatos() {
  if (process.env.ORBE_DATOS) return process.env.ORBE_DATOS
  if (process.platform === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'orbe')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'orbe')
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'orbe')
}

function argumentos(lista) {
  const r = {}
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i]
    if (!a.startsWith('--')) continue
    const clave = a.slice(2)
    const siguiente = lista[i + 1]
    if (siguiente === undefined || siguiente.startsWith('--')) r[clave] = true
    else {
      r[clave] = siguiente
      i++
    }
  }
  return r
}

async function leerEntrada() {
  if (process.stdin.isTTY) return ''
  const trozos = []
  for await (const t of process.stdin) trozos.push(t)
  return Buffer.concat(trozos).toString('utf8')
}

async function main() {
  const args = argumentos(process.argv.slice(2))
  let conexion
  try {
    conexion = JSON.parse(readFileSync(join(carpetaDatos(), 'conectores.json'), 'utf8'))
  } catch {
    return // Orbe no tiene los conectores encendidos
  }
  let ruta = '/v1/eventos'
  let cuerpo
  if (args['claude-code']) {
    ruta = '/v1/claude-code'
    cuerpo = await leerEntrada()
  } else {
    if (typeof args.titulo !== 'string') return
    cuerpo = JSON.stringify({ titulo: args.titulo, tipo: args.tipo, origen: args.origen, detalle: args.detalle, expresion: args.expresion })
  }
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), TIEMPO_MS)
  try {
    await fetch(`http://127.0.0.1:${Number(conexion.puerto)}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conexion.token}` },
      body: cuerpo,
      signal: control.signal
    })
  } catch {
    // Orbe cerrado o lento: se ignora
  } finally {
    clearTimeout(reloj)
  }
}

main().catch(() => {}).finally(() => process.exit(0))
