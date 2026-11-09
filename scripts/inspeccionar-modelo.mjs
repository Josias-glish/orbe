// Muestra qué tiene un GLB (mallas, triángulos, texturas): node scripts/inspeccionar-modelo.mjs modelo.glb
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(process.argv[2])
const root = doc.getRoot()
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) console.log('malla', m.getName(), 'triángulos', Math.round((p.getIndices()?.getCount() ?? 0) / 3))
for (const t of root.listTextures()) console.log('textura', t.getName(), t.getMimeType(), t.getSize()?.join('×'), Math.round(t.getImage().byteLength / 1024) + ' KB')
