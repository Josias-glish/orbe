// Articula el conejo de Orbe: le pone un esqueleto de 30 huesos (cuerpo, hombros, capucha, cuello, cabeza y once
// por oreja) con pesos calculados por código, marca qué vértices llevan pelo y limpia las texturas (negro uniforme,
// cristales lisos y brillantes).
//
// Uso: node scripts/articular-modelo.mjs [--proporcion 0.42] [--lado 1024] [entrada.glb] [salida.glb]
//   --proporcion  fracción de triángulos que se conserva (1 = todos los del original)
//   --lado        tamaño de las texturas de color, emisión y rugosidad (las normales conservan 2048)
//
// El modelo es una sola malla fusionada sin huesos. Las zonas se deducen de la altura (h: 0 = base, 1 = punta de
// las orejas) y del mapa de rugosidad, que separa pelo y tela (rugosos) de gafas, auriculares y orbe (lisos).
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { dequantize, weld, simplify, prune, reorder, meshopt } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(`--${nombre}`)
  return i >= 0 ? Number(args.splice(i, 2)[1]) : porDefecto
}
const PROPORCION = opcion('proporcion', 0.42)
const LADO = opcion('lado', 1024)
const entrada = args[0] ?? 'resources/personaje/conejo.glb'
const salida = args[1] ?? 'sitio/assets/conejo.glb'

// Calibración del modelo (fracciones de la altura). Si cambia el modelo, se ajusta aquí.
const CUELLO = 0.372 // por encima, todo lo rugoso es pelo
const OREJA_DESDE = 0.695
const OREJA_PASO = 0.026
const SEGMENTOS_OREJA = 11
const EJE_OREJA = [[0.7, 0.21], [0.8, 0.31], [0.9, 0.35], [1, 0.36]] // [altura, |x| del eje]

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const doc = await io.read(entrada)
await doc.transform(dequantize(), weld())
if (PROPORCION < 1) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: PROPORCION, error: 0.0008 }))

const raizDoc = doc.getRoot()
const nodoMalla = raizDoc.listNodes().find((n) => n.getMesh())
const prim = nodoMalla.getMesh().listPrimitives()[0]
const material = prim.getMaterial()

// 1. Posiciones en espacio del mundo (se hornea la escala del nodo: con esqueleto, el nodo debe quedar neutro).
const P = prim.getAttribute('POSITION')
const n = P.getCount()
const pos = new Float32Array(n * 3)
const esc = nodoMalla.getScale()
const tras = nodoMalla.getTranslation()
const min = [Infinity, Infinity, Infinity]
const max = [-Infinity, -Infinity, -Infinity]
for (let i = 0; i < n; i++) {
  const p = P.getElement(i, [])
  for (let k = 0; k < 3; k++) {
    const v = p[k] * esc[k] + tras[k]
    pos[i * 3 + k] = v
    min[k] = Math.min(min[k], v)
    max[k] = Math.max(max[k], v)
  }
}
P.setArray(pos).setNormalized(false)
nodoMalla.setScale([1, 1, 1]).setTranslation([0, 0, 0])
const alto = max[1] - min[1]
const centroX = (min[0] + max[0]) / 2
const yDe = (h) => min[1] + h * alto

// 2. Texturas: se leen para clasificar y se limpian. Rugoso + oscuro = pelo o tela; liso + oscuro = gafas y nariz.
const leer = async (t) => {
  const { data, info } = await sharp(Buffer.from(t.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}
const tColor = material.getBaseColorTexture()
const tRug = material.getMetallicRoughnessTexture()
const tNormal = material.getNormalTexture()
const [color, rug, normal] = await Promise.all([leer(tColor), leer(tRug), leer(tNormal)])
if (color.w !== rug.w || color.w !== normal.w) throw new Error('Las texturas del modelo deben medir lo mismo.')
const rugosoOriginal = Uint8Array.from({ length: rug.w * rug.h }, (_, i) => rug.data[i * 3 + 1])
for (let i = 0; i < color.w * color.h; i++) {
  const luz = 0.299 * color.data[i * 3] + 0.587 * color.data[i * 3 + 1] + 0.114 * color.data[i * 3 + 2]
  const saturado = Math.max(color.data[i * 3], color.data[i * 3 + 1], color.data[i * 3 + 2]) - Math.min(color.data[i * 3], color.data[i * 3 + 1], color.data[i * 3 + 2]) > 60
  if (luz > 80 || saturado) continue // auriculares, herrajes y orbe se quedan como están
  if (rugosoOriginal[i] > 128) {
    // Pelo y tela: negro uniforme, sin las manchas del horneado.
    color.data.set([9, 9, 10], i * 3)
  } else {
    // Gafas y nariz: negro piano, muy liso, y sin el relieve rayado del modelo original.
    color.data.set([3, 3, 4], i * 3)
    rug.data[i * 3 + 1] = 52
    rug.data[i * 3 + 2] = 0
    for (let k = 0; k < 3; k++) normal.data[i * 3 + k] = [128, 128, 255][k]
  }
}
const escribir = async (t, img, lado, calidad) => {
  const s = sharp(Buffer.from(img.data), { raw: { width: img.w, height: img.h, channels: 3 } })
  t.setImage(await (lado < img.w ? s.resize(lado, lado) : s).webp({ quality: calidad }).toBuffer()).setMimeType('image/webp')
}
doc.createExtension(EXTTextureWebP).setRequired(true)
await escribir(tColor, color, LADO, 86)
await escribir(tRug, rug, LADO, 86)
await escribir(tNormal, normal, 2048, 90)
const tEmision = material.getEmissiveTexture()
if (tEmision) await escribir(tEmision, await leer(tEmision), LADO, 86)

// 3. Rugosidad por vértice.
const UV = prim.getAttribute('TEXCOORD_0')
const rugoso = new Float32Array(n)
for (let i = 0; i < n; i++) {
  const [u, v] = UV.getElement(i, [])
  const x = Math.min(rug.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * rug.w)))
  const y = Math.min(rug.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * rug.h)))
  rugoso[i] = rugosoOriginal[y * rug.w + x] > 128 ? 1 : 0
}

// 4. Vecinos (para suavizar las máscaras: un vértice mal clasificado en una costura de UV haría un pico al doblar).
const indices = prim.getIndices().getArray()
const vecinos = Array.from({ length: n }, () => [])
for (let t = 0; t < indices.length; t += 3) {
  const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]]
  vecinos[a].push(b, c)
  vecinos[b].push(a, c)
  vecinos[c].push(a, b)
}
function suavizar(m, pasadas) {
  let actual = m
  for (let p = 0; p < pasadas; p++) {
    const sig = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const v = vecinos[i]
      let s = actual[i] * 2
      for (const j of v) s += actual[j]
      sig[i] = s / (v.length + 2)
    }
    actual = sig
  }
  return actual
}
const escalon = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// 5. Máscaras: oreja (rugoso, por encima de la cabeza, fuera del centro) y pelo (rugoso por encima del cuello, o
//    justo debajo si la superficie mira hacia abajo: es la parte baja de la cabeza, no la capucha. Así el pelo no
//    se corta en una línea que parecía una boca).
const h = new Float32Array(n)
let mOreja = new Float32Array(n)
let mPelo = new Float32Array(n)
const N = prim.getAttribute('NORMAL')
for (let i = 0; i < n; i++) {
  const [x, y] = [pos[i * 3], pos[i * 3 + 1]]
  h[i] = (y - min[1]) / alto
  mOreja[i] = rugoso[i] && h[i] > OREJA_DESDE - 0.005 && Math.abs(x - centroX) > 0.05 * alto ? 1 : 0
  mPelo[i] = rugoso[i] && (h[i] > CUELLO || (h[i] > 0.3 && N.getElement(i, [])[1] < -0.08)) ? 1 : 0
}
mOreja = suavizar(mOreja, 6)
mPelo = suavizar(mPelo, 2)

// 6. Huesos. Cada vértice recibe como mucho cuatro influencias.
const NOMBRES = ['cadera', 'columna', 'pecho', 'hombroI', 'hombroD', 'capucha', 'cuello', 'cabeza']
const I = Object.fromEntries(NOMBRES.map((nombre, i) => [nombre, i]))
const OREJA_I = NOMBRES.length
const OREJA_D = OREJA_I + SEGMENTOS_OREJA
// Cadena vertical del cuerpo: [hueso, altura del pivote]. Entre dos pivotes, el peso pasa del uno al otro.
const CADENA = [[I.cadera, 0], [I.columna, 0.1], [I.pecho, 0.2], [I.cuello, 0.33], [I.cabeza, 0.4]]

const articulaciones = new Uint8Array(n * 4)
const pesos = new Float32Array(n * 4)
const extra = new Float32Array(n * 2) // TEXCOORD_1: x = pelo, y = cuánto es oreja (0 en la base, 1 en la punta)
for (let i = 0; i < n; i++) {
  const [x, , z] = [pos[i * 3] - centroX, 0, pos[i * 3 + 2]]
  const influencias = []
  const o = mOreja[i] * escalon(OREJA_DESDE - 0.01, OREJA_DESDE + 0.025, h[i])
  if (o > 0.001) {
    const base = x < 0 ? OREJA_I : OREJA_D
    const u = Math.min(SEGMENTOS_OREJA - 1, Math.max(0, (h[i] - OREJA_DESDE) / OREJA_PASO))
    const k = Math.min(SEGMENTOS_OREJA - 2, Math.floor(u))
    const f = escalon(0, 1, u - k)
    influencias.push([I.cabeza, 1 - o], [base + k, o * (1 - f)], [base + k + 1, o * f])
    extra[i * 2 + 1] = o * Math.min(1, u / (SEGMENTOS_OREJA - 1))
  } else {
    let k = 0
    while (k < CADENA.length - 2 && h[i] > CADENA[k + 1][1]) k++
    const f = escalon(CADENA[k][1], CADENA[k + 1][1], h[i])
    // Hombros y capucha toman parte del peso del cuerpo: solo tela, lejos del eje.
    const tela = 1 - escalon(0.31, 0.36, h[i])
    const hombro = tela * 0.6 * escalon(0.2, 0.5, Math.abs(x)) * escalon(0.03, 0.14, h[i])
    const capucha = 0.8 * escalon(-0.18, -0.34, z) * escalon(0.17, 0.25, h[i]) * (1 - escalon(0.37, 0.41, h[i]))
    const resto = 1 - hombro - capucha * (1 - hombro)
    influencias.push([CADENA[k][0], resto * (1 - f)], [CADENA[k + 1][0], resto * f], [x < 0 ? I.hombroI : I.hombroD, hombro], [I.capucha, capucha * (1 - hombro)])
  }
  influencias.sort((a, b) => b[1] - a[1])
  const total = influencias.slice(0, 4).reduce((s, v) => s + v[1], 0)
  influencias.slice(0, 4).forEach(([hueso, peso], k) => {
    articulaciones[i * 4 + k] = peso > 0 ? hueso : 0
    pesos[i * 4 + k] = peso / total
  })
  extra[i * 2] = mPelo[i]
}
prim.setAttribute('JOINTS_0', doc.createAccessor('articulaciones').setType('VEC4').setArray(articulaciones))
prim.setAttribute('WEIGHTS_0', doc.createAccessor('pesos').setType('VEC4').setArray(pesos))
prim.setAttribute('TEXCOORD_1', doc.createAccessor('zonas').setType('VEC2').setArray(extra))

const escena = raizDoc.listScenes()[0]
const piel = doc.createSkin('esqueleto')
const pivotes = []
function hueso(nombre, pivote, padre, pivotePadre) {
  const nodo = doc.createNode(nombre).setTranslation(pivote.map((v, k) => v - pivotePadre[k]))
  padre.addChild(nodo)
  piel.addJoint(nodo)
  pivotes.push(pivote)
  return nodo
}
const raiz = doc.createNode('raiz')
escena.addChild(raiz)
const p = {
  cadera: [centroX, yDe(0), 0], columna: [centroX, yDe(0.1), 0], pecho: [centroX, yDe(0.2), 0],
  hombroI: [centroX - 0.3, yDe(0.22), 0], hombroD: [centroX + 0.3, yDe(0.22), 0], capucha: [centroX, yDe(0.3), -0.25],
  cuello: [centroX, yDe(0.33), -0.02], cabeza: [centroX, yDe(0.4), -0.02]
}
// El orden de creación es el índice del hueso: debe coincidir con NOMBRES.
const cadera = hueso('cadera', p.cadera, raiz, [0, 0, 0])
const columna = hueso('columna', p.columna, cadera, p.cadera)
const pecho = hueso('pecho', p.pecho, columna, p.columna)
hueso('hombroI', p.hombroI, pecho, p.pecho)
hueso('hombroD', p.hombroD, pecho, p.pecho)
hueso('capucha', p.capucha, pecho, p.pecho)
const cuello = hueso('cuello', p.cuello, pecho, p.pecho)
const cabeza = hueso('cabeza', p.cabeza, cuello, p.cuello)
const ejeOreja = (altura) => {
  let k = 0
  while (k < EJE_OREJA.length - 2 && altura > EJE_OREJA[k + 1][0]) k++
  const [[h0, x0], [h1, x1]] = [EJE_OREJA[k], EJE_OREJA[k + 1]]
  return x0 + ((x1 - x0) * Math.min(1, Math.max(0, (altura - h0) / (h1 - h0))))
}
for (const [nombre, signo] of [['orejaI', -1], ['orejaD', 1]]) {
  let padre = cabeza
  let pPadre = p.cabeza
  for (let k = 0; k < SEGMENTOS_OREJA; k++) {
    const altura = OREJA_DESDE + k * OREJA_PASO
    const pivote = [centroX + signo * ejeOreja(altura), yDe(altura), -0.03]
    padre = hueso(`${nombre}${k + 1}`, pivote, padre, pPadre)
    pPadre = pivote
  }
}
const inversas = new Float32Array(pivotes.length * 16)
pivotes.forEach((q, i) => inversas.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -q[0], -q[1], -q[2], 1], i * 16))
piel.setInverseBindMatrices(doc.createAccessor('inversas').setType('MAT4').setArray(inversas)).setSkeleton(raiz)
nodoMalla.setSkin(piel).setName('conejo')
material.setName('conejo')

await doc.transform(prune({ keepAttributes: true }), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
mkdirSync(dirname(salida), { recursive: true })
await io.write(salida, doc)
const tri = prim.getIndices().getCount() / 3
console.log(`Modelo articulado: ${salida} · ${Math.round(statSync(salida).size / 1024)} KB · ${Math.round(tri)} triángulos · ${prim.getAttribute('POSITION').getCount()} vértices · ${pivotes.length} huesos`)
