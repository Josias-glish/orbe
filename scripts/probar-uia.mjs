// Prueba el lector de pantalla a mano: pon en primer plano la ventana que quieras (el Bloc de notas con texto
// seleccionado, Edge o Chrome con una página, el Explorador…) y mira qué lee Orbe. Solo lee cuando lo ejecutas tú.
//
//   npm run probar-uia                    espera 5 s y lee la ventana que esté en primer plano
//   npm run probar-uia -- --espera=10     más tiempo para cambiar de ventana
//   npm run probar-uia -- --completo      imprime todo el texto (por defecto, solo el principio)
//   npm run probar-uia -- --max=2000      máximo de caracteres que se piden al lector
//   npm run probar-uia -- --hwnd=197324   lee esa ventana concreta, sin esperar ni mirar el primer plano
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const carpetaHelper = join(aqui, '..', 'helper')
const cacheDir = join(tmpdir(), 'orbe-uia-prueba')

const opciones = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [clave, valor] = a.replace(/^--/, '').split('=')
    return [clave, valor ?? true]
  })
)
const espera = Number.isFinite(Number(opciones.espera)) ? Number(opciones.espera) : 5
const max = Number.isInteger(Number(opciones.max)) && Number(opciones.max) > 0 ? Number(opciones.max) : 8000
const completo = opciones.completo === true
const hwnd = Number.isInteger(Number(opciones.hwnd)) && Number(opciones.hwnd) > 0 ? Number(opciones.hwnd) : null

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const sinParametros = (url) => {
  try {
    const u = new URL(url)
    u.username = u.password = u.search = u.hash = ''
    return u.href
  } catch {
    return url
  }
}
const vista = (texto) => {
  if (completo) return texto
  const lineas = texto.split(/\r?\n/).slice(0, 12).join('\n')
  return lineas.length > 700 ? `${lineas.slice(0, 700)}…` : lineas
}

mkdirSync(cacheDir, { recursive: true })
const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const hijo = spawn(
  ps,
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(carpetaHelper, 'uia-helper.ps1'), '-PidOrbe', String(process.pid), '-CacheDir', cacheDir],
  { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true }
)

const pendientes = new Map()
let listo
const preparado = new Promise((resolver, rechazar) => (listo = { resolver, rechazar }))
let contador = 0

createInterface({ input: hijo.stdout }).on('line', (linea) => {
  let m
  try {
    m = JSON.parse(linea)
  } catch {
    return
  }
  if (m.tipo === 'listo') listo.resolver()
  else if (m.tipo === 'error') listo.rechazar(new Error(m.mensaje))
  else if (pendientes.has(m.id)) {
    const { resolver, rechazar } = pendientes.get(m.id)
    pendientes.delete(m.id)
    if (m.ok) resolver(m.datos)
    else rechazar(new Error(m.error))
  }
})
hijo.on('exit', (codigo) => listo.rechazar(new Error(`El lector se cerró (código ${codigo}).`)))

function pedir(op, parametros = {}) {
  return new Promise((resolver, rechazar) => {
    const id = ++contador
    pendientes.set(id, { resolver, rechazar })
    hijo.stdin.write(`${JSON.stringify({ id, op, ...parametros })}\n`)
    setTimeout(() => pendientes.has(id) && (pendientes.delete(id), rechazar(new Error(`«${op}» no respondió en 20 s.`))), 20_000)
  })
}

async function principal() {
  console.log('Preparando el lector de pantalla (la primera vez compila el C#, ~2 s)…')
  await preparado

  if (!hwnd) {
    console.log(`\nPon en primer plano la ventana que quieres probar. Leo en ${espera} s…`)
    for (let s = espera; s > 0; s--) {
      process.stdout.write(`  ${s}…\r`)
      await dormir(1000)
    }
    process.stdout.write('        \r')
  }

  const { ventana } = await pedir('ventana', hwnd ? { hwnd } : {})
  if (!ventana) {
    console.log('No hay ninguna ventana que leer.')
    return 1
  }
  console.log('\n— Ventana —')
  console.log(`  Aplicación: ${ventana.aplicacion} (${ventana.proceso}, pid ${ventana.pid})`)
  console.log(`  Título:     ${ventana.titulo || '(sin título)'}`)
  if (ventana.esNavegador) console.log(`  Dirección:  ${ventana.url ? sinParametros(ventana.url) : `(barra: ${ventana.barra ?? 'no encontrada'})`}`)
  console.log(`  En primer plano: ${ventana.primerPlano ? 'sí' : 'no (es la última que estuvo)'}${ventana.restringida ? ' · RESTRINGIDA (¿administrador?)' : ''}`)

  const seleccion = await pedir('seleccion', { hwnd: ventana.hwnd, max })
  console.log('\n— Selección —')
  if (seleccion.texto) console.log(`  Método: ${seleccion.metodo} · ${seleccion.texto.length} caracteres\n${vista(seleccion.texto).replace(/^/gm, '    ')}`)
  else console.log('  (no hay texto seleccionado, o esa aplicación no lo expone)')

  const contenido = await pedir('contenido', { hwnd: ventana.hwnd, max })
  console.log('\n— Contenido —')
  if (contenido.texto) {
    console.log(`  Método: ${contenido.metodo}${contenido.parcial ? ' (parcial)' : ''} · ${contenido.texto.length} caracteres\n${vista(contenido.texto).replace(/^/gm, '    ')}`)
  } else {
    console.log('  (no se pudo leer texto de esa ventana)')
  }
  return 0
}

let codigo = 1
try {
  codigo = await principal()
} catch (error) {
  console.error(`\nError: ${error.message}`)
} finally {
  hijo.stdin.end()
  hijo.kill()
}
process.exit(codigo)
