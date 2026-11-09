// Prepara un modelo 3D (GLB) para el personaje de Orbe: limita las texturas a 2048 px (o --lado 1024 para gastar
// un cuarto de memoria de vídeo), comprime la geometría con meshopt y quita lo que no se usa.
// Uso: npm run modelo -- entrada.glb [salida.glb] [--lado 2048]   (por defecto, resources/personaje/conejo.glb)
const { app, nativeImage } = require('electron')
const { join, resolve } = require('node:path')
const { mkdirSync, statSync } = require('node:fs')

const posLado = process.argv.indexOf('--lado')
const LADO = posLado > 0 ? Number(process.argv[posLado + 1]) || 2048 : 2048
const args = process.argv.slice(2).filter((a, i, todos) => !a.startsWith('--') && todos[i - 1] !== '--lado')
const entrada = args[0] && resolve(args[0])
const salida = resolve(args[1] ?? join(__dirname, '..', 'resources', 'personaje', 'conejo.glb'))

app.whenReady().then(async () => {
  if (!entrada) {
    console.error('Uso: npm run modelo -- entrada.glb [salida.glb]')
    return app.exit(1)
  }
  const { NodeIO } = require('@gltf-transform/core')
  const { ALL_EXTENSIONS, EXTMeshoptCompression } = require('@gltf-transform/extensions')
  const { dedup, prune, weld, reorder, meshopt } = require('@gltf-transform/functions')
  const { MeshoptEncoder, MeshoptDecoder } = require('meshoptimizer')
  await MeshoptEncoder.ready
  await MeshoptDecoder.ready
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
  const doc = await io.read(entrada)

  for (const textura of doc.getRoot().listTextures()) {
    const imagen = nativeImage.createFromBuffer(Buffer.from(textura.getImage()))
    if (imagen.isEmpty()) continue
    const { width, height } = imagen.getSize()
    const factor = Math.min(1, LADO / Math.max(width, height))
    const reducida = factor === 1 ? imagen : imagen.resize({ width: Math.round(width * factor), height: Math.round(height * factor), quality: 'best' })
    // Todas en JPEG (ningún mapa de este modelo necesita transparencia); el de normales con más calidad.
    const esNormal = /normal/i.test(textura.getName())
    textura.setImage(reducida.toJPEG(esNormal ? 92 : 85)).setMimeType('image/jpeg')
  }
  await doc.transform(dedup(), weld(), reorder({ encoder: MeshoptEncoder }), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  mkdirSync(join(salida, '..'), { recursive: true })
  await io.write(salida, doc)
  console.log(`Modelo listo: ${salida} (${Math.round(statSync(salida).size / 1024)} KB)`)
  app.exit(0)
}).catch((e) => {
  console.error(e)
  app.exit(1)
})
