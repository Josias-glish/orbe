// Articula el conejo de Orbe: le pone un esqueleto de 30 huesos (cuerpo, hombros, capucha, cuello, cabeza y once
// por oreja) con pesos calculados por código, marca qué vértices llevan pelo y limpia las texturas (negro uniforme,
// cristales lisos y brillantes).
//
// Uso: node scripts/articular-modelo.mjs [--proporcion 0.42] [--lado 1024] [--orejas 11] [--subdividir 0] [--pelo 0] [entrada.glb] [salida.glb]
//   --proporcion  fracción de triángulos que se conserva (1 = todos los del original)
//   --orejas      huesos por oreja (más huesos = curva más suave, como un músculo; el sitio usa 11)
//   --subdividir  veces que cada triángulo se parte en cuatro (1 = cuatro veces más triángulos, superficie más curva)
//   --pelo        capas de pelo como geometría, para visores que no son el sitio (0 = sin pelo)
//   --lado        tamaño de las texturas de color, emisión y rugosidad (las normales conservan 2048)
//
// El modelo es una sola malla fusionada sin huesos. Las zonas se deducen de la altura (h: 0 = base, 1 = punta de
// las orejas) y del mapa de rugosidad, que separa pelo y tela (rugosos) de gafas, auriculares y orbe (lisos).
// Las gafas del modelo original (borde ondulado, cristales abollados) se convierten en cara con pelo y delante va
// una montura nueva generada por código, calcada de la imagen de referencia: simétrica y con cristales planos.
import { Shape, ExtrudeGeometry, ShapeGeometry, BoxGeometry, BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Matrix4, Vector2, Vector3, Vector4 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP, KHRTextureTransform } from '@gltf-transform/extensions'
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
const SEGMENTOS_OREJA = opcion('orejas', 11)
const SUBDIVIDIR = opcion('subdividir', 0)
const PELO = opcion('pelo', 0)
const entrada = args[0] ?? 'resources/personaje/conejo.glb'
const salida = args[1] ?? 'sitio/assets/conejo.glb'

// Calibración del modelo (fracciones de la altura). Si cambia el modelo, se ajusta aquí.
const CUELLO = 0.372 // por encima, todo lo rugoso es pelo
const OREJA_DESDE = 0.695
const OREJA_PASO = 0.286 / SEGMENTOS_OREJA // la oreja mide 0.286 de la altura
const EJE_OREJA = [[0.7, 0.21], [0.8, 0.31], [0.9, 0.35], [1, 0.36]] // [altura, |x| del eje]

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const doc = await io.read(entrada)
await doc.transform(dequantize(), weld())
if (PROPORCION < 1) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: PROPORCION, error: 0.0008 }))

for (let v = 0; v < SUBDIVIDIR; v++) subdividir(doc.getRoot().listMeshes()[0].listPrimitives()[0])

// Parte cada triángulo en cuatro. El punto nuevo de cada arista se acerca a los planos tangentes de sus dos extremos
// (teselado de Phong), así la silueta se curva en vez de quedar igual de facetada. Las normales para ese empuje se
// unen por posición: los vértices duplicados en una costura de UV se mueven igual y no se abre la malla.
function subdividir(prim) {
  const ind = prim.getIndices().getArray()
  const P = prim.getAttribute('POSITION').getArray()
  const n = P.length / 3
  const clave = (i) => `${P[i * 3].toFixed(5)},${P[i * 3 + 1].toFixed(5)},${P[i * 3 + 2].toFixed(5)}`
  const grupo = new Uint32Array(n)
  const porClave = new Map()
  for (let i = 0; i < n; i++) {
    const k = clave(i)
    if (!porClave.has(k)) porClave.set(k, porClave.size)
    grupo[i] = porClave.get(k)
  }
  const nor = new Float64Array(porClave.size * 3)
  for (let t = 0; t < ind.length; t += 3) {
    const [a, b, c] = [ind[t] * 3, ind[t + 1] * 3, ind[t + 2] * 3]
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]]
    const w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]
    const cara = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    for (const i of [a, b, c]) for (let k = 0; k < 3; k++) nor[grupo[i / 3] * 3 + k] += cara[k]
  }
  for (let g = 0; g < nor.length; g += 3) {
    const l = Math.hypot(nor[g], nor[g + 1], nor[g + 2]) || 1
    for (let k = 0; k < 3; k++) nor[g + k] /= l
  }
  // Aristas: cada una recibe un vértice nuevo.
  const medio = new Map()
  const pares = []
  const de = (a, b) => {
    const k = a < b ? a * n + b : b * n + a
    let m = medio.get(k)
    if (m === undefined) {
      m = n + pares.length / 2
      medio.set(k, m)
      pares.push(a, b)
    }
    return m
  }
  const nuevos = new Uint32Array(ind.length * 4)
  for (let t = 0; t < ind.length; t += 3) {
    const [a, b, c] = [ind[t], ind[t + 1], ind[t + 2]]
    const [ab, bc, ca] = [de(a, b), de(b, c), de(c, a)]
    nuevos.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], t * 4)
  }
  const total = n + pares.length / 2
  for (const nombre of prim.listSemantics()) {
    const acc = prim.getAttribute(nombre)
    const tam = acc.getElementSize()
    const viejo = acc.getArray()
    const arr = new Float32Array(total * tam)
    arr.set(viejo)
    for (let e = 0; e < pares.length; e += 2) {
      const [a, b, m] = [pares[e], pares[e + 1], n + e / 2]
      for (let k = 0; k < tam; k++) arr[m * tam + k] = (viejo[a * tam + k] + viejo[b * tam + k]) / 2
      if (nombre === 'POSITION') {
        for (const i of [a, b]) {
          const g = grupo[i] * 3
          let d = 0
          for (let k = 0; k < 3; k++) d += (arr[m * 3 + k] - viejo[i * 3 + k]) * nor[g + k]
          for (let k = 0; k < 3; k++) arr[m * 3 + k] -= 0.3 * d * nor[g + k] // 0.6 de empuje, repartido entre los dos extremos
        }
      } else if (nombre === 'NORMAL' || nombre === 'TANGENT') {
        const l = Math.hypot(arr[m * tam], arr[m * tam + 1], arr[m * tam + 2]) || 1
        for (let k = 0; k < 3; k++) arr[m * tam + k] /= l
        if (tam === 4) arr[m * 4 + 3] = viejo[a * 4 + 3]
      }
    }
    acc.setArray(arr)
  }
  prim.getIndices().setArray(nuevos)
}

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

// 7. Gafas. Medidas en unidades del modelo (mide 2 de alto, centrado en el origen), calcadas de la imagen de referencia.
// El frente no pasa de z = 0.452 (el límite del modelo original): si la caja del modelo crece, la compresión mueve el esqueleto.
const GAFAS = { frente: 0.438, fondo: 0.028, caida: 0.4, redondeo: 0.04, hueco: 0.007 }
// z del frente de la montura: dos paños casi planos que se doblan en el puente (una hipérbola), no una curva continua.
const zGafas = (x) => GAFAS.frente - GAFAS.caida * (Math.hypot(x, GAFAS.redondeo) - GAFAS.redondeo)
{
  // 7a. Las gafas originales pasan a ser cara. El modelo es una sola piel: debajo de las gafas no hay cabeza, así que
  // sus vértices se recolocan sobre la cabeza (esfera ajustada al pelo de la cara) y se pintan y marcan como pelo.
  const esGafa = new Uint8Array(n)
  const esNariz = new Uint8Array(n)
  const rugPelo = [0, 0] // suma y cuenta de la rugosidad del pelo de la cara: la cara nueva se pinta igual
  const A = new Array(16).fill(0)
  const B = [0, 0, 0, 0]
  for (let i = 0; i < n; i++) {
    const [x, y, z] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]
    const [u, v] = UV.getElement(i, [])
    const tx = (Math.min(color.h - 1, Math.floor((v - Math.floor(v)) * color.h)) * color.w + Math.min(color.w - 1, Math.floor((u - Math.floor(u)) * color.w))) * 3
    if (rugoso[i]) {
      if (z > 0 && h[i] > 0.42 && h[i] < 0.66 && mOreja[i] < 0.01) {
        rugPelo[0] += rug.data[tx + 1]
        rugPelo[1]++
        // Mínimos cuadrados de x² + y² + z² = 2ax + 2by + 2cz + d.
        const v = [2 * x, 2 * y, 2 * z, 1]
        for (let f = 0; f < 4; f++) {
          B[f] += v[f] * (x * x + y * y + z * z)
          for (let c = 0; c < 4; c++) A[f * 4 + c] += v[f] * v[c]
        }
      }
    }
    if (Math.abs(x) < 0.045 && y < -0.06 && y > -0.14) {
      // La nariz se queda; en la referencia es algo más ancha y está un poco más arriba.
      if (!rugoso[i] && z > 0.3) {
        esNariz[i] = 1
        pos[i * 3] *= 1.17
        pos[i * 3 + 1] += 0.006
      }
      continue
    }
    // El pelo que asomaba entre las gafas viejas también se alisa: toda la cara bajo las gafas queda continua.
    if (rugoso[i]) {
      if (Math.abs(x) < 0.4 && y > -0.14 && y < 0.125 && z > 0.25) esGafa[i] = 1
      continue
    }
    if (Math.abs(x) > 0.46 || y < -0.2 || y > 0.2 || z < 0.05) continue
    if (color.data[tx] <= 40 || Math.abs(x) < 0.3) esGafa[i] = 1 // junto a los auriculares, lo claro son herrajes; en la cara, brillos de las gafas
  }
  const sol = new Vector4(...B).applyMatrix4(new Matrix4().set(...A).invert())
  const centro = [sol.x, sol.y, sol.z]
  const R = Math.sqrt(sol.w + sol.x ** 2 + sol.y ** 2 + sol.z ** 2)
  console.log(`Cabeza: centro ${centro.map((v) => v.toFixed(3))} · radio ${R.toFixed(3)}`)

  // Los vértices duplicados en una costura de UV se mueven juntos: se agrupan por posición.
  const porClave = new Map()
  const grupo = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    const k = `${pos[i * 3].toFixed(5)},${pos[i * 3 + 1].toFixed(5)},${pos[i * 3 + 2].toFixed(5)}`
    if (!porClave.has(k)) porClave.set(k, i)
    grupo[i] = porClave.get(k)
    if (esGafa[i]) esGafa[grupo[i]] = 1
  }
  const radio = new Float32Array(n)
  const vecinosGafa = new Map()
  for (let i = 0; i < n; i++) {
    esGafa[i] = esGafa[grupo[i]]
    radio[i] = esGafa[i] ? R : Math.hypot(pos[i * 3] - centro[0], pos[i * 3 + 1] - centro[1], pos[i * 3 + 2] - centro[2])
    if (!esGafa[i]) continue
    if (!vecinosGafa.has(grupo[i])) vecinosGafa.set(grupo[i], [])
    for (const j of vecinos[i]) vecinosGafa.get(grupo[i]).push(grupo[j])
  }
  // El radio se relaja hacia el de los vecinos: la cara nueva empalma sin escalón con el pelo que la rodea.
  for (let pasada = 0; pasada < 400; pasada++) {
    for (const [g, lista] of vecinosGafa) {
      let suma = 0
      for (const j of lista) suma += radio[j]
      radio[g] = suma / lista.length
    }
  }
  for (let i = 0; i < n; i++) {
    if (!esGafa[i]) continue
    const d = [pos[i * 3] - centro[0], pos[i * 3 + 1] - centro[1], pos[i * 3 + 2] - centro[2]]
    const largo = Math.hypot(...d)
    for (let k = 0; k < 3; k++) pos[i * 3 + k] = centro[k] + (d[k] / largo) * radio[grupo[i]]
    N.setElement(i, d.map((v) => v / largo))
    extra[i * 2] = 1
  }

  // Al recolocarlos, algunos triángulos de las gafas viejas quedan del revés (eran paredes de la montura) y no se
  // dibujarían: se les da la vuelta para que la cara no tenga huecos.
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]]
    if (!esGafa[a] && !esGafa[b] && !esGafa[c]) continue
    const q = [a, b, c].map((i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]])
    const [e1, e2] = [1, 2].map((k) => q[k].map((w, j) => w - q[0][j]))
    const nrm = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    if (nrm.reduce((suma, w, j) => suma + w * (q[0][j] - centro[j]), 0) < 0) [indices[t + 1], indices[t + 2]] = [c, b]
  }

  // En las texturas, los triángulos de las gafas viejas se pintan como pelo. De paso se anota qué celdas de la
  // textura no usa ningún triángulo: dos de ellas dan el material a la montura y a los cristales nuevos.
  const CELDAS = 64
  const ocupada = new Uint8Array(CELDAS * CELDAS)
  const [W, H] = [color.w, color.h]
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]]
    const q = tri.map((i) => UV.getElement(i, [])).map(([u, v]) => [(u - Math.floor(u)) * W, (v - Math.floor(v)) * H])
    const [x0, x1, y0, y1] = [Math.min(...q.map((e) => e[0])), Math.max(...q.map((e) => e[0])), Math.min(...q.map((e) => e[1])), Math.max(...q.map((e) => e[1]))]
    const celda = (v, lado) => Math.min(CELDAS - 1, Math.max(0, Math.floor((v / lado) * CELDAS)))
    for (let cy = celda(y0 - 2, H); cy <= celda(y1 + 2, H); cy++) for (let cx = celda(x0 - 2, W); cx <= celda(x1 + 2, W); cx++) ocupada[cy * CELDAS + cx] = 1
    // También se repasa el pelo de la cabeza: el modelo original trae manchas lisas (brillantes) en medio del pelo.
    const nariz = tri.every((i) => esNariz[i])
    const gafa = tri.some((i) => esGafa[i])
    if (!nariz && !gafa && !tri.every((i) => extra[i * 2] > 0.5)) continue
    const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1])
    for (let y = Math.max(0, Math.floor(y0) - 2); y <= Math.min(H - 1, Math.ceil(y1) + 2); y++) {
      for (let x = Math.max(0, Math.floor(x0) - 2); x <= Math.min(W - 1, Math.ceil(x1) + 2); x++) {
        // Coordenadas baricéntricas del centro del píxel, con margen para que no quede un filo sin pintar.
        const w1 = ((x + 0.5 - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (y + 0.5 - q[0][1])) / area
        const w2 = ((q[1][0] - q[0][0]) * (y + 0.5 - q[0][1]) - (x + 0.5 - q[0][0]) * (q[1][1] - q[0][1])) / area
        if (Math.abs(area) > 1 && (w1 < -0.2 || w2 < -0.2 || w1 + w2 > 1.2)) continue
        const k = (y * W + x) * 3
        if (!nariz && !gafa && (rugosoOriginal[y * W + x] > 128 || color.data[k] > 40)) continue
        color.data.set(nariz ? [22, 22, 24] : [9, 9, 10], k)
        rug.data.set([rug.data[k], nariz ? 95 : Math.round(rugPelo[0] / rugPelo[1]), 0], k)
        normal.data.set([128, 128, 255], k)
      }
    }
  }
  const libres = [...ocupada.keys()].filter((k) => !ocupada[k])
  if (libres.length < 2) throw new Error('No quedan celdas libres en la textura para el material de las gafas.')
  const muestra = (k, rgb, rugosidad) => {
    const [cx, cy, lado] = [k % CELDAS, Math.floor(k / CELDAS), W / CELDAS]
    for (let y = cy * lado; y < (cy + 1) * lado; y++) {
      for (let x = cx * lado; x < (cx + 1) * lado; x++) {
        color.data.set(rgb, (y * W + x) * 3)
        rug.data.set([255, rugosidad, 0], (y * W + x) * 3)
        normal.data.set([128, 128, 255], (y * W + x) * 3)
      }
    }
    return [(cx + 0.5) / CELDAS, (cy + 0.5) / CELDAS]
  }
  // La montura es satinada y algo más clara que el pelo; por debajo de 0.42 de rugosidad el sitio no la trata como pelo.
  const uvMontura = muestra(libres[0], [26, 26, 29], 98)
  const uvCristal = muestra(libres[1], [3, 3, 4], 22)

  // 7b. Montura y cristales nuevos. Los contornos son medio lado (x ≥ 0) y se reflejan: las dos mitades son idénticas.
  const lazo = (puntos) => new Shape(new CatmullRomCurve3(puntos.map(([x, y]) => new Vector3(x, y, 0)), true, 'centripetal').getPoints(puntos.length * 8).slice(0, -1).map((q) => new Vector2(q.x, q.y)))
  const espejo = (puntos) => puntos.map(([x, y]) => [-x, y]).reverse()
  // Los puntos están medidos sobre la imagen; «real» deshace la perspectiva (los cantos quedan más lejos de la cámara).
  const real = (puntos) => puntos.map(([x, y]) => [x * (0.997 + 0.034 * x), y * (0.997 + 0.034 * x)])
  const MITAD = real([
    [0, 0.106], [0.05, 0.11], [0.1, 0.118], [0.15, 0.1227], [0.2, 0.1247], [0.25, 0.123], [0.3, 0.1185], [0.35, 0.11], [0.375, 0.1025], [0.385, 0.096], // ceja
    [0.3855, 0.08], [0.385, 0.057], [0.383, 0.051], [0.378, 0.0457], [0.374, 0.037], [0.371, 0.02], [0.368, 0], [0.3654, -0.0247], [0.361, -0.049], // canto exterior
    [0.354, -0.069], [0.3444, -0.0864], [0.331, -0.101], [0.3136, -0.1123], [0.294, -0.1198], [0.25, -0.1284], [0.2, -0.1323], [0.15, -0.1304], // borde inferior
    [0.1235, -0.126], [0.101, -0.116], [0.0864, -0.1], [0.0716, -0.079], [0.059, -0.05], [0.0506, -0.0247], [0.0425, 0], [0.0346, 0.0296], // lado de la nariz
    [0.022, 0.0444], [0.011, 0.0494], [0, 0.0506] // puente
  ])
  const CRISTAL = real([
    [0.15, 0.1007], [0.2, 0.1025], [0.25, 0.1007], [0.3, 0.095], [0.326, 0.0864], [0.341, 0.0716], [0.348, 0.052], [0.35, 0.0247],
    [0.3494, -0.005], [0.346, -0.0346], [0.341, -0.059], [0.332, -0.079], [0.3185, -0.095], [0.3, -0.106], [0.25, -0.116], [0.2, -0.119],
    [0.15, -0.116], [0.1185, -0.106], [0.1, -0.0914], [0.0864, -0.069], [0.0753, -0.042], [0.0654, -0.01], [0.0588, 0.02], [0.0556, 0.0444],
    [0.0573, 0.064], [0.0642, 0.078], [0.079, 0.089], [0.1, 0.095], [0.1235, 0.0988]
  ])
  const partes = []
  const parte = (g, uv) => {
    const cuenta = g.getAttribute('position').count
    g.setAttribute('uv', new Float32BufferAttribute(Float32Array.from({ length: cuenta * 2 }, (_, k) => uv[k % 2]), 2))
    partes.push(g)
  }
  const montura = lazo([...MITAD, ...espejo(MITAD).slice(1, -1)])
  // Cada cristal es un plano exacto: la recta que une el frente de la montura en sus dos cantos, algo retranqueada.
  const xs = CRISTAL.map((q) => q[0])
  const [xa, xb] = [Math.min(...xs), Math.max(...xs)]
  const pendiente = (zGafas(xb) - zGafas(xa)) / (xb - xa)
  const zCristal = (x) => zGafas(xa) + pendiente * (Math.abs(x) - xa) - GAFAS.hueco
  for (const c of [CRISTAL, espejo(CRISTAL)]) {
    montura.holes.push(lazo(c))
    const medio = [(xa + xb) / 2 * Math.sign(c[0][0]), -0.012]
    const g = new ShapeGeometry(lazo(c.map(([x, y]) => [medio[0] + (x - medio[0]) * 1.05, medio[1] + (y - medio[1]) * 1.05])))
    const q = g.getAttribute('position')
    for (let i = 0; i < q.count; i++) q.setZ(i, zCristal(q.getX(i)))
    const plano = g.toNonIndexed()
    plano.computeVertexNormals()
    parte(plano, uvCristal)
  }
  const bisel = 0.0035
  // La tapa de la extrusión son triángulos largos que, al doblar la montura, quedarían como cuerdas tensas. Cada
  // arista más ancha que «paso» en x se parte por la mitad; la regla solo mira la arista, así que dos triángulos
  // vecinos la parten igual y no se abre la malla.
  const partir = (g, paso) => {
    const q = g.getAttribute('position').array
    const pila = []
    const hechos = []
    for (let i = 0; i < q.length; i += 9) pila.push([0, 3, 6].map((k) => [q[i + k], q[i + k + 1], q[i + k + 2]]))
    while (pila.length) {
      const t = pila.pop()
      let [k, ancho] = [-1, paso]
      for (let e = 0; e < 3; e++) {
        const d = Math.abs(t[e][0] - t[(e + 1) % 3][0])
        if (d > ancho) [k, ancho] = [e, d]
      }
      if (k < 0) {
        hechos.push(...t.flat())
        continue
      }
      const [a, b, c] = [t[k], t[(k + 1) % 3], t[(k + 2) % 3]]
      const medio = a.map((v, j) => (v + b[j]) / 2)
      pila.push([a, medio, c], [medio, b, c])
    }
    return hechos
  }
  const v = partir(new ExtrudeGeometry(montura, { depth: GAFAS.fondo - 2 * bisel, bevelThickness: bisel, bevelSize: bisel, bevelOffset: -bisel, bevelSegments: 3, curveSegments: 1 }), 0.015)
  for (let i = 0; i < v.length; i += 3) v[i + 2] += bisel - GAFAS.fondo + zGafas(v[i])
  // Normales: cada esquina suma las de las caras que comparten su posición y forman menos de ~37° con la suya,
  // ponderadas por área. Así los cantos quedan vivos, lo demás liso, y un triángulo fino no ensucia a sus vecinos.
  const caras = []
  const enPunto = new Map()
  const clave = (i) => `${v[i].toFixed(5)},${v[i + 1].toFixed(5)},${v[i + 2].toFixed(5)}`
  for (let t = 0; t < v.length; t += 9) {
    const [e1, e2] = [3, 6].map((k) => [v[t + k] - v[t], v[t + k + 1] - v[t + 1], v[t + k + 2] - v[t + 2]])
    caras.push([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]])
    for (const k of [0, 3, 6]) {
      if (!enPunto.has(clave(t + k))) enPunto.set(clave(t + k), [])
      enPunto.get(clave(t + k)).push(t / 9)
    }
  }
  const normales = []
  for (let t = 0; t < v.length; t += 9) {
    // Un triángulo casi sin área (puntos del contorno en línea) no tiene normal fiable: toma la de sus vecinos.
    let propia = caras[t / 9]
    if (Math.hypot(...propia) < 2e-8) {
      propia = [0, 0, 0]
      for (const k of [0, 3, 6]) for (const f of enPunto.get(clave(t + k))) if (Math.hypot(...caras[f]) >= 2e-8) for (let j = 0; j < 3; j++) propia[j] += caras[f][j]
    }
    for (const k of [0, 3, 6]) {
      const suma = [0, 0, 0]
      for (const f of enPunto.get(clave(t + k))) {
        const o = caras[f]
        if (Math.hypot(...o) >= 2e-8 && o[0] * propia[0] + o[1] * propia[1] + o[2] * propia[2] > 0.8 * Math.hypot(...o) * Math.hypot(...propia)) for (let j = 0; j < 3; j++) suma[j] += o[j]
      }
      normales.push(...(Math.hypot(...suma) > 0 ? suma : [0, 0, 1]).map((w, _, q) => w / Math.hypot(...q)))
    }
  }
  parte(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(v, 3)).setAttribute('normal', new Float32BufferAttribute(normales, 3)), uvMontura)
  // Patillas: del canto de la montura hacia los auriculares.
  for (const lado of [-1, 1]) {
    const [x0, z0, x1, z1] = [0.379, zGafas(0.379) - GAFAS.fondo / 2, 0.396, 0.12]
    const largo = Math.hypot(x1 - x0, z1 - z0)
    parte(new BoxGeometry(0.01, 0.036, largo).rotateY(lado * Math.atan2(x1 - x0, z1 - z0)).translate((lado * (x0 + x1)) / 2, 0.064, (z0 + z1) / 2).toNonIndexed(), uvMontura)
  }
  const gafas = mergeGeometries(partes)
  const [gp, gn, gu] = ['position', 'normal', 'uv'].map((a) => gafas.getAttribute(a))
  const m = gp.count
  console.log(`Cristal: centro x ${((xa + xb) / 2).toFixed(3)} · z ${zCristal((xa + xb) / 2).toFixed(3)} · giro ${Math.atan(-pendiente).toFixed(3)} rad`)

  for (const nombre of prim.listSemantics()) {
    const acc = prim.getAttribute(nombre)
    const tam = acc.getElementSize()
    const arr = new (acc.getArray().constructor)((n + m) * tam)
    arr.set(acc.getArray())
    for (let i = 0; i < m; i++) {
      const valor = { POSITION: [gp.getX(i), gp.getY(i), gp.getZ(i)], NORMAL: [gn.getX(i), gn.getY(i), gn.getZ(i)], TEXCOORD_0: [gu.getX(i), gu.getY(i)], JOINTS_0: [I.cabeza, 0, 0, 0], WEIGHTS_0: [1, 0, 0, 0], TANGENT: [1, 0, 0, 1] }[nombre]
      if (valor) arr.set(valor, (n + i) * tam)
    }
    acc.setArray(arr)
  }
  const viejos = prim.getIndices().getArray()
  const todos = new Uint32Array(viejos.length + m)
  todos.set(viejos)
  for (let i = 0; i < m; i++) todos[viejos.length + i] = n + i
  prim.getIndices().setArray(todos)
}

// 8. Pelo de verdad (--pelo N): N copias de la zona de pelo, cada una un poco más fuera, con una textura de mechones
// recortada por alfa. Es glTF corriente: lo dibuja cualquier visor, sin el sombreador del sitio.
let triPelo = 0
const MECHONES = 200
const mechones = []
if (PELO > 0) {
  const [P, N, U, Z, J, W] = ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1', 'JOINTS_0', 'WEIGHTS_0'].map((s) => prim.getAttribute(s))
  const ind = prim.getIndices().getArray()
  const nuevo = new Map()
  const tris = []
  let areaUv = 0
  let area3 = 0
  for (let i = 0; i < ind.length; i += 3) {
    const t = [ind[i], ind[i + 1], ind[i + 2]]
    if (t.reduce((s, v) => s + Z.getElement(v, [])[0], 0) <= 1.2) continue
    for (const v of t) { if (!nuevo.has(v)) nuevo.set(v, nuevo.size); tris.push(nuevo.get(v)) }
    const [a, b, c] = t.map((v) => P.getElement(v, []))
    const [ua, ub, uc] = t.map((v) => U.getElement(v, []))
    const [e, f] = [b.map((q, k) => q - a[k]), c.map((q, k) => q - a[k])]
    area3 += Math.hypot(e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]) / 2
    areaUv += Math.abs((ub[0] - ua[0]) * (uc[1] - ua[1]) - (ub[1] - ua[1]) * (uc[0] - ua[0])) / 2
  }
  const m = nuevo.size
  const origen = [...nuevo.keys()]
  const copia = (acc) => {
    const tam = acc.getElementSize()
    const arr = new (acc.getArray().constructor)(m * PELO * tam)
    for (let k = 0; k < PELO; k++) origen.forEach((v, i) => arr.set(acc.getElement(v, []), (k * m + i) * tam))
    return doc.createAccessor().setType(acc.getType()).setNormalized(acc.getNormalized()).setArray(arr)
  }
  const pos = copia(P)
  const colores = new Float32Array(m * PELO * 4)
  for (let k = 0; k < PELO; k++) {
    const capa = (k + 1) / PELO
    origen.forEach((v, i) => {
      const [x, y, z] = P.getElement(v, [])
      const nn = N.getElement(v, [])
      // Junto a las gafas el pelo se queda al ras (la misma caja que usa el sitio): no debe asomar por los cristales.
      const gafas = Math.max(Math.abs(x) - 0.42, Math.abs(y + 0.004) - 0.14, 0.2 - z)
      const largo = 0.021 * capa * (0.12 + 0.88 * Math.min(1, Math.max(0, gafas / 0.07)))
      pos.setElement(k * m + i, [x + nn[0] * largo, y + nn[1] * largo - 0.004 * capa * capa, z + nn[2] * largo])
      // El color del vértice aclara la punta; su alfa, multiplicado por el de la textura, afina cada mechón.
      colores.set([0.01 + 0.028 * capa, 0.01 + 0.028 * capa, 0.011 + 0.028 * capa, 1 - 0.45 * capa], (k * m + i) * 4)
    })
  }
  // Mechones guía: puntos repartidos por el pelo (cada vez, el más lejano de los ya elegidos). Cada uno lleva una
  // cadena de PELO huesos, uno por capa; cada capa de cada pelo sigue al hueso de su altura en los 4 mechones más
  // próximos, así que todo pelo se dobla en PELO tramos. Un hueso por pelo real serían cientos de miles.
  const pv = origen.map((v) => P.getElement(v, []))
  const nv = origen.map((v) => N.getElement(v, []))
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  const lejos = new Float32Array(m).fill(Infinity)
  let elegido = 0
  for (let g = 0; g < MECHONES; g++) {
    const [pesos, js] = [W.getElement(origen[elegido], []), J.getElement(origen[elegido], [])]
    mechones.push({ p: pv[elegido], n: nv[elegido], padre: js[pesos.indexOf(Math.max(...pesos))] })
    let [mejor, siguiente] = [-1, 0]
    for (let i = 0; i < m; i++) {
      lejos[i] = Math.min(lejos[i], d2(pv[i], pv[elegido]))
      if (lejos[i] > mejor) [mejor, siguiente] = [lejos[i], i]
    }
    elegido = siguiente
  }
  const HUESOS_BASE = 8 + 2 * SEGMENTOS_OREJA
  const huesosPelo = new Uint16Array(m * PELO * 4)
  const pesosPelo = new Float32Array(m * PELO * 4)
  for (let i = 0; i < m; i++) {
    // La normal cuenta: un pelo de una cara de la oreja no debe seguir a un mechón de la otra.
    const cerca = mechones.map((q, g) => [d2(pv[i], q.p) * (3 - 2 * (nv[i][0] * q.n[0] + nv[i][1] * q.n[1] + nv[i][2] * q.n[2])), g]).sort((a, b) => a[0] - b[0]).slice(0, 4)
    const pesos = cerca.map(([d]) => 1 / (d + 1e-5))
    const total = pesos.reduce((s, w) => s + w, 0)
    for (let k = 0; k < PELO; k++) {
      huesosPelo.set(cerca.map(([, g]) => HUESOS_BASE + g * PELO + k), (k * m + i) * 4)
      pesosPelo.set(pesos.map((w) => w / total), (k * m + i) * 4)
    }
  }

  const indices = new Uint32Array(tris.length * PELO)
  for (let k = 0; k < PELO; k++) for (let i = 0; i < tris.length; i++) indices[k * tris.length + i] = tris[i] + k * m
  triPelo = indices.length / 3

  // Textura de mechones que se repite: 32 × 32 celdas, cada una un punto de altura al azar.
  const [LADO_PELO, CELDA] = [256, 8]
  const px = Buffer.alloc(LADO_PELO * LADO_PELO * 4, 255)
  let semilla = 7
  const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647)
  for (let cy = 0; cy < LADO_PELO; cy += CELDA) for (let cx = 0; cx < LADO_PELO; cx += CELDA) {
    const [ox, oy, alto] = [3.5 + (azar() - 0.5) * 3, 3.5 + (azar() - 0.5) * 3, 0.56 + 0.44 * azar()]
    for (let y = 0; y < CELDA; y++) for (let x = 0; x < CELDA; x++) {
      px[((cy + y) * LADO_PELO + cx + x) * 4 + 3] = Math.round(255 * Math.max(0, alto * (1 - 0.6 * (Math.hypot(x - ox, y - oy) / 5) ** 2)))
    }
  }
  const tPelo = doc.createTexture('pelo').setMimeType('image/png').setImage(await sharp(px, { raw: { width: LADO_PELO, height: LADO_PELO, channels: 4 } }).png().toBuffer())
  const mPeloCapas = doc.createMaterial('pelo').setBaseColorTexture(tPelo).setAlphaMode('MASK').setAlphaCutoff(0.5).setRoughnessFactor(1).setMetallicFactor(0)
  // 150 mechones por unidad de modelo, como en el sitio: la escala sale de cuánto ocupa el pelo en el mapa UV.
  const repeticion = 150 / ((LADO_PELO / CELDA) * Math.sqrt(areaUv / area3))
  mPeloCapas.getBaseColorTextureInfo().setExtension('KHR_texture_transform', doc.createExtension(KHRTextureTransform).createTransform().setScale([repeticion, repeticion]))
  nodoMalla.getMesh().addPrimitive(doc.createPrimitive().setMaterial(mPeloCapas).setIndices(doc.createAccessor().setType('SCALAR').setArray(indices))
    .setAttribute('POSITION', pos).setAttribute('NORMAL', copia(N)).setAttribute('TEXCOORD_0', copia(U)).setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(huesosPelo)).setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(pesosPelo))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(colores)))
  console.log(`Pelo: ${PELO} capas · ${triPelo} triángulos · textura repetida ${repeticion.toFixed(1)} veces`)
}

await escribir(tColor, color, LADO, 86)
await escribir(tRug, rug, LADO, 86)
await escribir(tNormal, normal, 2048, 90)
const tEmision = material.getEmissiveTexture()
if (tEmision) await escribir(tEmision, await leer(tEmision), LADO, 86)

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
// Huesos del pelo: cada mechón cuelga del hueso que más pesa en su raíz y sube por la normal, un hueso por capa.
const tiempos = Float32Array.from({ length: 25 }, (_, f) => (f * 4) / 24)
const viento = [0.958, 0, 0.287]
const brisa = mechones.length ? doc.createAnimation('brisa') : null
const tiempo = brisa && doc.createAccessor('tiempo').setType('SCALAR').setArray(tiempos)
mechones.forEach((q, g) => {
  let padre = piel.listJoints()[q.padre]
  let pPadre = pivotes[q.padre]
  // El pelo se peina hacia donde sopla: cada hueso se desliza un poco más que el anterior sobre la piel (la parte del
  // viento perpendicular a la normal). Girarlos levantaría de la piel el pelo que queda lejos de la raíz del mechón.
  const nw = q.n[0] * viento[0] + q.n[1] * viento[1] + q.n[2] * viento[2]
  const rumbo = viento.map((v, j) => v - q.n[j] * nw)
  // Brisa en bucle de 4 s: una onda que cruza el conejo y otra más rápida que rompe la uniformidad.
  const fuerza = Array.from(tiempos, (t) => Math.sin((Math.PI * t) / 2 - 6 * (q.p[0] * viento[0] + q.p[2] * viento[2])) + 0.4 * Math.sin(Math.PI * t - 11 * q.p[1] + g))
  for (let k = 0; k < PELO; k++) {
    const pivote = q.p.map((v, j) => v + (q.n[j] * 0.021 * k) / PELO)
    const reposo = pivote.map((v, j) => v - pPadre[j])
    padre = hueso(`pelo${g + 1}_${k + 1}`, pivote, padre, pPadre)
    pPadre = pivote
    // La raíz (k = 0) no se mueve; la punta acaba desplazada hasta 0,6 veces el largo del pelo.
    const pasos = Float32Array.from(fuerza.flatMap((f) => reposo.map((v, j) => v + rumbo[j] * f * 0.00016 * k)))
    const muestra = doc.createAnimationSampler().setInput(tiempo).setOutput(doc.createAccessor().setType('VEC3').setArray(pasos)).setInterpolation('LINEAR')
    brisa.addSampler(muestra).addChannel(doc.createAnimationChannel().setTargetNode(padre).setTargetPath('translation').setSampler(muestra))
  }
})
const inversas = new Float32Array(pivotes.length * 16)
pivotes.forEach((q, i) => inversas.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -q[0], -q[1], -q[2], 1], i * 16))
piel.setInverseBindMatrices(doc.createAccessor('inversas').setType('MAT4').setArray(inversas)).setSkeleton(raiz)
nodoMalla.setSkin(piel).setName('conejo')
material.setName('conejo')

// Con pelo el archivo va sin comprimir: el importador de Blender no lee meshopt.
await doc.transform(weld(), prune({ keepAttributes: true }), ...(PELO > 0 ? [] : [reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'medium' })]))
mkdirSync(dirname(salida), { recursive: true })
await io.write(salida, doc)
const tri = prim.getIndices().getCount() / 3
console.log(`Modelo articulado: ${salida} · ${Math.round(statSync(salida).size / 1024)} KB · ${Math.round(tri + triPelo)} triángulos · ${prim.getAttribute('POSITION').getCount()} vértices · ${pivotes.length} huesos`)
