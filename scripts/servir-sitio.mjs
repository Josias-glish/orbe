// Sirve la carpeta sitio/ en local para probarla: node scripts/servir-sitio.mjs [puerto]
// Solo para desarrollo. Acepta además PUT /assets/conejo-poster.png para guardar el póster que se captura del 3D.
import { createServer } from 'node:http'
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(fileURLToPath(new URL('../sitio', import.meta.url)))
const puerto = Number(process.argv[2] ?? process.env.PORT ?? 4173)
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8' }

createServer((req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (req.method === 'PUT' && ruta === '/assets/conejo-poster.png') {
    req.pipe(createWriteStream(join(raiz, 'assets', 'conejo-poster.png'))).on('finish', () => res.writeHead(204).end())
    return
  }
  let archivo = normalize(join(raiz, ruta))
  if (!archivo.startsWith(raiz)) return res.writeHead(403).end()
  if (existsSync(archivo) && statSync(archivo).isDirectory()) archivo = join(archivo, 'index.html')
  if (!existsSync(archivo)) return res.writeHead(404, { 'content-type': 'text/plain' }).end('No encontrado')
  res.writeHead(200, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream', 'content-length': statSync(archivo).size, 'cache-control': 'no-store' })
  createReadStream(archivo).pipe(res)
}).listen(puerto, '127.0.0.1', () => console.log(`Sitio de Orbe en http://127.0.0.1:${puerto}/`))
