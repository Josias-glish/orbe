// El conejo de Orbe en 3D. El GLB trae un esqueleto de 30 huesos (cuerpo, cuello, cabeza y once por oreja; ver
// scripts/articular-modelo.mjs) pero ningún clip: todo el movimiento se calcula aquí.
import {
  AdditiveBlending, CanvasTexture, Color, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, PMREMGenerator, PointLight, RepeatWrapping, Scene,
  SkinnedMesh, SRGBColorSpace, TextureLoader, ACESFilmicToneMapping, Vector3, WebGLRenderer, Group
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

/** Color de la luz (ojos, contraluz, aura) en cada estado: blanco, gris y rojo, como el sitio. */
export const COLOR_ESTADO = {
  reposo: '#ffffff', leyendo: '#f2f2f2', pensando: '#a9abb3', respondiendo: '#ffffff', escuchando: '#ff3b4e', actuando: '#ff2a3d'
}

// Cada estado es una postura a la que tienden los muelles. Ángulos en radianes: cabeza [cabeceo, ladeo];
// orejas [hacia atrás(+)/delante(−), hacia fuera(+)/dentro(−)]. orbe: [brillo base, vaivén, pulsos por segundo].
const POSTURA = {
  reposo: { cabeza: [0, 0], oI: [0, 0], oD: [0, 0], apertura: 1, curva: 0, orbe: [1.1, 0.3, 0.22] },
  leyendo: { cabeza: [0.14, 0], oI: [0.1, 0.05], oD: [0.1, 0.05], apertura: 0.82, curva: 0, orbe: [0.9, 0.15, 0.35], barrido: true },
  pensando: { cabeza: [-0.1, 0.13], oI: [-0.06, 0], oD: [0.3, 0.42], apertura: 0.9, curva: 0, orbe: [0.7, 0.55, 0.13], mirada: [0.55, -0.75] },
  respondiendo: { cabeza: [0, 0], oI: [-0.05, 0.06], oD: [-0.05, 0.06], apertura: 1, curva: 0.85, orbe: [1.5, 0.6, 0.8], asiente: true },
  escuchando: { cabeza: [-0.04, -0.09], oI: [-0.2, -0.1], oD: [-0.2, -0.1], apertura: 1.18, curva: 0, orbe: [1.2, 0.35, 0.4] },
  actuando: { cabeza: [0.05, 0], oI: [0.26, 0.02], oD: [0.26, 0.02], apertura: 0.72, curva: 0, orbe: [1.9, 0.5, 1.3], bote: 1 }
}

// Calidad: capas de pelo y densidad de píxeles. Si los fps caen, se baja un nivel (nunca se vuelve a subir).
const CALIDAD = [{ capas: 12, dpr: 2 }, { capas: 7, dpr: 1.5 }, { capas: 4, dpr: 1 }, { capas: 0, dpr: 1 }]

// Medidas del modelo en reposo (unidades del GLB: mide 1,9 de alto con el centro en el origen).
const BASE_Y = -0.951
const ALTO = 1.899
const CUELLO_Y = BASE_Y + 0.372 * ALTO
const SEGMENTOS_OREJA = 11
// Centro, z y giro del cristal: los imprime scripts/articular-modelo.mjs al generar la montura («Cristal: …»).
const LENTE = { x: 0.204, y: -0.008, z: 0.365, giro: 0.368, ancho: 0.28, alto: 0.2 }

const suave = (p) => p * p * (3 - 2 * p)
const campana = (p) => Math.sin(Math.PI * Math.min(1, Math.max(0, p)))
const tender = (a, b, dt, ritmo) => a + (b - a) * (1 - Math.exp(-dt * ritmo))
function muelle(m, objetivo, dt, rigidez, freno) {
  m.v += ((objetivo - m.x) * rigidez - m.v * freno) * dt
  m.x += m.v * dt
}

const GLSL_COMUN = /* glsl */ `
varying vec3 vReposo;
varying vec3 vReposoN;
uniform sampler2D uPelo;
uniform sampler2D uTejido;
uniform float uCuello;
// 1 donde hay pelo: por encima del cuello, o justo debajo si la superficie mira hacia abajo (la parte baja de
// la cabeza, metida en el cuello de la sudadera; la capucha mira hacia arriba y hacia fuera).
float alturaPelo(vec3 p, vec3 n) {
  float bajo = smoothstep(-0.04, -0.14, n.y) * step(uCuello - 0.14, p.y);
  return max(smoothstep(uCuello - 0.012, uCuello + 0.012, p.y), bajo);
}
float triplanar(sampler2D t, vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z + 1e-5);
  return texture2D(t, p.zy).r * w.x + texture2D(t, p.xz).r * w.y + texture2D(t, p.xy).r * w.z;
}`

/**
 * Detalle fino sobre el material horneado: mechones cortos en cabeza y orejas, punto en la sudadera y un borde
 * aterciopelado. La zona se decide por píxel con el mapa de rugosidad del propio modelo (pelo y tela son rugosos;
 * gafas, auriculares y orbe, lisos) y la altura del cuello, medida en la pose de reposo.
 */
function vestir(material, texturas) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uPelo = { value: texturas.pelo }
    sh.uniforms.uTejido = { value: texturas.tejido }
    sh.uniforms.uCuello = { value: CUELLO_Y }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vReposo;\nvarying vec3 vReposoN;\nvarying float vPelo;\nattribute vec2 zona;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvReposo = position;\nvReposoN = normal;\nvPelo = zona.x;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMUN}\nvarying float vPelo;\nfloat zPelo; float zTela; float relieve;`)
      .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
{
  // La zona por vértice tapa las costuras del mapa, donde el muestreo se equivoca.
  float blando = max(smoothstep(0.42, 0.6, texture2D(roughnessMap, vRoughnessMapUv).g), step(0.97, vPelo));
  float arriba = alturaPelo(vReposo, normalize(vReposoN));
  zPelo = blando * arriba;
  zTela = blando * (1.0 - arriba);
  vec3 n = normalize(vReposoN);
  // Pelo y punto pequeños respecto al conejo: muchas repeticiones a lo alto de la figura.
  float dPelo = triplanar(uPelo, vReposo * 9.0, n);
  float dTela = triplanar(uTejido, vReposo * 11.0, n);
  relieve = zPelo * dPelo * 0.6 + zTela * dTela;
  // Negro de verdad: el detalle apenas levanta el tono.
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.004) + dPelo * vec3(0.016), zPelo);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.005) + dTela * vec3(0.02), zTela);
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.96, max(zPelo, zTela));')
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
{
  // Relieve del detalle (la misma técnica que el bumpMap de three, con derivadas de pantalla).
  vec3 dpx = dFdx(vViewPosition), dpy = dFdy(vViewPosition);
  float hx = dFdx(relieve), hy = dFdy(relieve);
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  normal = normalize(abs(det) * normal - 0.016 * sign(det) * (hx * r1 + hy * r2));
}`)
      .replace('#include <opaque_fragment>', /* glsl */ `{
  // Terciopelo: el pelo y la tela devuelven luz en los bordes, no en el centro.
  float borde = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.6);
  outgoingLight += borde * (zPelo * vec3(0.085) + zTela * vec3(0.03));
}
#include <opaque_fragment>`)
  }
  material.customProgramCacheKey = () => 'orbe-cuerpo'
  material.needsUpdate = true
}

/** Material de una capa de pelo: la malla desplazada a lo largo de la normal, con huecos entre mechones. */
function materialCapa(capa, texturas, mascara, compartido) {
  const m = new MeshStandardMaterial({ color: 0x000000, roughness: 1, metalness: 0 })
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uPelo: { value: texturas.pelo }, uTejido: { value: texturas.tejido }, uCuello: { value: CUELLO_Y },
      uMascara: { value: mascara }, uCapa: { value: capa }, uMecer: compartido.mecer, uLuz: compartido.luz
    })
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vReposo;\nvarying vec3 vReposoN;\nvarying vec2 vUvPelo;\nvarying float vPelo;\nattribute vec2 zona;\nuniform float uCapa;\nuniform vec3 uMecer;')
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
vReposo = position; vReposoN = normal; vUvPelo = uv; vPelo = zona.x;
// Pelo corto: 1,1 % de la altura del conejo; en las orejas se mece más con el movimiento.
// Junto a las gafas el pelo se queda al ras: no debe asomar sobre la montura ni los cristales.
float gafas = max(max(abs(position.x) - 0.42, abs(position.y + 0.004) - 0.14), 0.2 - position.z);
float largoPelo = mix(0.12, 1.0, smoothstep(0.0, 0.07, gafas));
transformed += normal * (0.021 * uCapa * largoPelo) + uMecer * (uCapa * uCapa) * (0.5 + zona.y) * largoPelo;`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMUN}\nvarying vec2 vUvPelo;\nvarying float vPelo;\nuniform sampler2D uMascara;\nuniform float uCapa;\nuniform vec3 uLuz;`)
      .replace('#include <map_fragment>', /* glsl */ `
if ((texture2D(uMascara, vUvPelo).g < 0.5 && vPelo < 0.97) || alturaPelo(vReposo, normalize(vReposoN)) < 0.5) discard;
// Mechones: celdas con centro y grosor al azar; cada pelo se afina hacia la punta.
vec3 q = vReposo * 150.0 + vec3(vReposo.y, vReposo.z, vReposo.x) * 23.0;
vec3 c = floor(q);
vec3 azar = fract(sin(vec3(dot(c, vec3(127.1, 311.7, 74.7)), dot(c, vec3(269.5, 183.3, 246.1)), dot(c, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
float mechon = triplanar(uPelo, vReposo * 9.0, normalize(vReposoN));
float largo = 0.45 + 0.55 * azar.x * (0.6 + 0.8 * mechon);
if (uCapa > largo) discard;
if (length(fract(q) - 0.5 - (azar - 0.5) * 0.5) > 0.56 * (1.0 - 0.7 * uCapa / largo)) discard;
diffuseColor.rgb = vec3(0.003) + (0.008 + 0.02 * mechon) * uCapa;`)
      .replace('#include <opaque_fragment>', /* glsl */ `{
  float borde = pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 2.2);
  outgoingLight += borde * uCapa * (vec3(0.075) + uLuz * 0.035);
}
#include <opaque_fragment>`)
  }
  m.customProgramCacheKey = () => 'orbe-pelo'
  return m
}

/** Un ojo de luz en el cristal (versión reducida de dibujo-led.ts de la aplicación). */
function dibujarOjo(ctx, w, h, o) {
  ctx.clearRect(0, 0, w, h)
  const cx = w / 2 + o.mx * w * 0.13
  const cy = h * 0.54 + o.my * h * 0.12
  ctx.save()
  ctx.shadowColor = ctx.fillStyle = ctx.strokeStyle = o.color
  ctx.shadowBlur = h * 0.1 * o.brillo
  ctx.lineCap = 'round'
  ctx.lineWidth = h * 0.08
  if (o.forma === 'feliz' || o.apertura < 0.16) {
    const signo = o.forma === 'feliz' ? -1 : 0.5
    ctx.beginPath()
    ctx.moveTo(cx - w * 0.12, cy + (signo < 0 ? h * 0.1 : 0))
    ctx.quadraticCurveTo(cx, cy + signo * h * 0.3, cx + w * 0.12, cy + (signo < 0 ? h * 0.1 : 0))
    ctx.stroke()
  } else {
    const rx = w * 0.115 * o.pupila
    const ry = Math.max(h * 0.05, h * 0.27 * o.apertura)
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()
    if (o.curva > 0.3) {
      // Sin boca, la sonrisa está en la mirada: el ojo se vuelve media luna.
      const k = Math.min(1, (o.curva - 0.3) / 0.6)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.shadowBlur = 0
      ctx.beginPath()
      ctx.ellipse(cx, cy + ry * (1.55 - 0.55 * k), rx * 1.4, ry * 1.05, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.arc(cx + rx * 0.35, cy - ry * 0.4, Math.min(rx, ry) * 0.26, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

async function descargar(url, alAvanzar, pesoPrevisto) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`No se pudo descargar ${url}`)
  const total = Number(r.headers.get('content-length')) || pesoPrevisto
  if (!r.body) return r.arrayBuffer()
  const lector = r.body.getReader()
  const trozos = []
  let recibido = 0
  for (;;) {
    const { done, value } = await lector.read()
    if (done) break
    trozos.push(value)
    recibido += value.length
    alAvanzar(Math.min(0.97, recibido / total))
  }
  const todo = new Uint8Array(recibido)
  let p = 0
  for (const t of trozos) { todo.set(t, p); p += t.length }
  return todo.buffer
}

/**
 * Crea la escena sobre un <canvas>. Devuelve los mandos que usa la página:
 * pose (encuadre), estado, mirar, tocar, activo, y fotograma (un dibujo suelto, para el póster).
 */
export async function crearEscena(lienzo, { base = './', alAvanzar = () => {}, calidad = 0, pesoModelo = 1770000 } = {}) {
  const renderer = new WebGLRenderer({ canvas: lienzo, alpha: true, antialias: true, powerPreference: 'high-performance' })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.setClearColor(0x000000, 0)

  const escena = new Scene()
  const camara = new PerspectiveCamera(24, 1, 0.1, 60)
  const DISTANCIA = 9
  const pmrem = new PMREMGenerator(renderer)
  escena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  escena.environmentIntensity = 0.55
  pmrem.dispose()

  // Luz de cabina: una principal blanca y dos contraluces, uno del color del estado y otro rojo.
  escena.add(new HemisphereLight(0xffffff, 0x1c1c20, 0.6))
  const principal = new DirectionalLight(0xffffff, 2.1)
  principal.position.set(1.4, 2.2, 3)
  const contraCian = new DirectionalLight(0xffffff, 2.6)
  contraCian.position.set(-2.6, 1.2, -2.2)
  const contraVioleta = new DirectionalLight(0xff2a3d, 3)
  contraVioleta.position.set(2.6, 0.6, -2)
  escena.add(principal, contraCian, contraVioleta)

  const cargador = new TextureLoader()
  const detalle = async (archivo) => {
    const t = await cargador.loadAsync(base + archivo)
    t.wrapS = t.wrapT = RepeatWrapping
    return t
  }
  const [datos, pelo, tejido] = await Promise.all([
    descargar(base + 'assets/conejo.glb', alAvanzar, pesoModelo), detalle('assets/pelo.webp'), detalle('assets/tejido.webp')
  ])
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(datos, base + 'assets/')
  alAvanzar(1)

  const pivote = new Group()
  pivote.add(gltf.scene)
  escena.add(pivote)
  const cuerpo = gltf.scene.getObjectByProperty('isSkinnedMesh', true)
  const hueso = (n) => gltf.scene.getObjectByName(n)
  const H = {
    cadera: hueso('cadera'), columna: hueso('columna'), pecho: hueso('pecho'), hombroI: hueso('hombroI'), hombroD: hueso('hombroD'),
    capucha: hueso('capucha'), cuello: hueso('cuello'), cabeza: hueso('cabeza'),
    oI: Array.from({ length: SEGMENTOS_OREJA }, (_, k) => hueso(`orejaI${k + 1}`)),
    oD: Array.from({ length: SEGMENTOS_OREJA }, (_, k) => hueso(`orejaD${k + 1}`))
  }
  cuerpo.frustumCulled = false
  const geo = cuerpo.geometry
  // El GLB guarda las zonas en TEXCOORD_1 (x = pelo, y = oreja); se renombra para no chocar con los mapas de three.
  geo.setAttribute('zona', geo.getAttribute('uv1'))
  geo.deleteAttribute('uv1')
  const texturas = { pelo, tejido }
  vestir(cuerpo.material, texturas)

  // Capas de pelo: solo los triángulos de la zona de pelo, la misma malla y el mismo esqueleto.
  const compartido = { mecer: { value: new Vector3() }, luz: { value: new Color(COLOR_ESTADO.reposo) } }
  const zona = geo.getAttribute('zona')
  const indices = geo.index.array
  const conPelo = []
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]]
    if (zona.getX(a) + zona.getX(b) + zona.getX(c) > 1.2) conPelo.push(a, b, c)
  }
  const geoPelo = geo.clone()
  geoPelo.setIndex(conPelo)
  const capas = []
  function fijarCapas(n) {
    for (const c of capas) { cuerpo.parent.remove(c); c.material.dispose() }
    capas.length = 0
    for (let i = 1; i <= n; i++) {
      const malla = new SkinnedMesh(geoPelo, materialCapa(i / n, texturas, cuerpo.material.roughnessMap, compartido))
      malla.bind(cuerpo.skeleton, cuerpo.bindMatrix)
      malla.frustumCulled = false
      cuerpo.parent.add(malla)
      capas.push(malla)
    }
  }

  // Ojos de luz: una pantalla transparente pegada a cada cristal, hija del hueso de la cabeza.
  pivote.updateMatrixWorld(true)
  const posCabeza = H.cabeza.getWorldPosition(new Vector3())
  const lentes = [-1, 1].map((lado) => {
    const lienzoOjo = Object.assign(document.createElement('canvas'), { width: 192, height: 128 })
    const textura = new CanvasTexture(lienzoOjo)
    textura.colorSpace = SRGBColorSpace
    const malla = new Mesh(
      new PlaneGeometry(LENTE.ancho, LENTE.alto),
      new MeshBasicMaterial({ map: textura, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false })
    )
    malla.position.set(lado * LENTE.x - posCabeza.x, LENTE.y - posCabeza.y, LENTE.z - posCabeza.z)
    malla.rotation.y = lado * LENTE.giro
    malla.renderOrder = 3
    H.cabeza.add(malla)
    return { ctx: lienzoOjo.getContext('2d'), textura, lienzo: lienzoOjo }
  })

  // El orbe del pecho ilumina la sudadera a su alrededor.
  const luzOrbe = new PointLight(0x7dd3fc, 0, 1.4, 1.6)
  luzOrbe.position.set(0, -0.63, 0.52).sub(H.pecho.getWorldPosition(new Vector3()))
  H.pecho.add(luzOrbe)

  // ---------------------------------------------------------------------------------------------
  // Estado de la animación
  // ---------------------------------------------------------------------------------------------
  let nivel = calidad
  let forzarTamano = true
  let ancho = 1
  let alto = 1
  let t = 0
  let estado = 'reposo'
  const post = { cabeza: [0, 0], oI: [0, 0], oD: [0, 0], apertura: 1, curva: 0, orbe: 1 }
  const poseMeta = { x: 0, alto: 0.8, base: 0, giro: 0, camY: 0 }
  const pose = { ...poseMeta }
  let poseLista = false
  const puntero = { x: 0, y: 0, cuando: -1e9 }
  const mirada = { x: 0, y: 0 }
  let paseo = { x: 0, y: 0, hasta: 0 }
  let parpadeo = 1
  let proximoParpadeo = 2
  let gesto = null // { id, inicio, dura }
  let pulso = 0
  let turnoToque = 0
  const orejas = { I: nuevaOreja(), D: nuevaOreja() }
  const previo = { x: 0, y: 0, cabY: 0, cabX: 0 }
  const colorLuz = new Color(COLOR_ESTADO.reposo)
  const colorMeta = new Color(COLOR_ESTADO.reposo)
  const centroCabeza = new Vector3()
  let firmaOjos = ''
  function nuevaOreja() {
    // Un muelle en la base y, detrás, cada segmento persigue al anterior: la onda viaja hasta la punta.
    return { bx: { x: 0, v: 0 }, bz: { x: 0, v: 0 }, x: new Float32Array(SEGMENTOS_OREJA), z: new Float32Array(SEGMENTOS_OREJA) }
  }

  function redimensionar() {
    const w = lienzo.clientWidth || 1
    const h = lienzo.clientHeight || 1
    if (w === ancho && h === alto && !forzarTamano) return
    forzarTamano = false
    ancho = w
    alto = h
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CALIDAD[nivel].dpr))
    renderer.setSize(w, h, false)
    camara.aspect = w / h
    camara.updateProjectionMatrix()
  }

  function fijarCalidad(n) {
    nivel = Math.min(CALIDAD.length - 1, n)
    fijarCapas(CALIDAD[nivel].capas)
    forzarTamano = true
    redimensionar()
  }

  function actualizar(dt) {
    t += dt
    const P = POSTURA[estado]
    const g = gesto ? { id: gesto.id, p: (t - gesto.inicio) / gesto.dura } : null
    if (g && g.p >= 1) gesto = null
    const saludo = g?.id === 'saludo' ? campana(g.p) : 0
    const sorpresa = g?.id === 'sorpresa' ? campana(g.p) : 0
    pulso = Math.max(0, pulso - dt * 1.4)

    // Encuadre: la página dice dónde y a qué tamaño va el conejo; aquí solo se llega con suavidad.
    for (const k of Object.keys(pose)) pose[k] = poseLista ? tender(pose[k], poseMeta[k], dt, 3.2) : poseMeta[k]
    const altoVisible = 2 * DISTANCIA * Math.tan((camara.fov * Math.PI) / 360)
    const escala = (pose.alto * altoVisible) / ALTO
    poseLista = true
    const bote = (P.bote ? Math.abs(Math.sin(t * 6.5)) * 0.018 : 0) + sorpresa * 0.07
    const x = pose.x * altoVisible * camara.aspect
    const y = -altoVisible / 2 + pose.base * altoVisible - BASE_Y * escala + bote * altoVisible * pose.alto
    pivote.position.set(x, y, 0)
    pivote.scale.setScalar(escala)
    pivote.rotation.y = pose.giro + Math.sin(t * 0.5) * 0.03
    camara.position.set(0, pose.camY * altoVisible, DISTANCIA)
    camara.lookAt(0, 0, 0)

    // Mirada: el cursor si se movió hace poco; si no, lo que pida el estado o un paseo tranquilo.
    let mx = 0
    let my = 0
    if (t - puntero.cuando < 4) {
      centroCabeza.setFromMatrixPosition(H.cabeza.matrixWorld).project(camara)
      const dx = puntero.x - centroCabeza.x
      const dy = puntero.y - (centroCabeza.y + 0.25 * pose.alto)
      mx = dx / (Math.abs(dx) + 0.55)
      my = -dy / (Math.abs(dy) + 0.55)
    } else if (P.barrido) {
      mx = Math.sin(t * 2.3) * 0.75
      my = 0.3
    } else if (P.mirada) {
      [mx, my] = P.mirada
    } else {
      if (t > paseo.hasta) paseo = { x: (Math.random() - 0.5) * 0.9, y: (Math.random() - 0.5) * 0.4, hasta: t + 1.8 + Math.random() * 3 }
      mx = paseo.x
      my = paseo.y
    }
    mirada.x = tender(mirada.x, mx, dt, 6)
    mirada.y = tender(mirada.y, my, dt, 6)

    // Postura del estado.
    for (const k of ['cabeza', 'oI', 'oD']) for (let i = 0; i < 2; i++) post[k][i] = tender(post[k][i], P[k][i], dt, 4)
    post.apertura = tender(post.apertura, sorpresa > 0.05 ? 1.32 : P.apertura, dt, 10)
    post.curva = tender(post.curva, saludo > 0.05 ? 1 : P.curva, dt, 8)

    // Cuerpo: la cadera se mece, la columna acompaña, el pecho respira y los hombros suben con el aire.
    const respira = Math.sin(t * 1.6)
    H.cadera.rotation.set(Math.sin(t * 0.7) * 0.008, 0, Math.sin(t * 0.9) * 0.012)
    H.cadera.scale.set(1, 1 + sorpresa * 0.05, 1)
    H.columna.rotation.set(Math.sin(t * 0.7 + 0.6) * 0.01, mirada.x * 0.05, Math.sin(t * 0.9 + 0.5) * 0.012)
    H.pecho.scale.set(1 + respira * 0.008, 1 + respira * 0.012, 1 + respira * 0.014)
    H.pecho.rotation.set(0, mirada.x * 0.07, 0)
    H.hombroI.rotation.z = -respira * 0.02 - saludo * 0.03
    H.hombroD.rotation.z = respira * 0.02 + saludo * 0.06
    // Cuello y cabeza se reparten el giro: sigue la mirada, asiente al responder, se ladea al saludar.
    const asiente = P.asiente ? Math.max(0, Math.sin(t * 5.2)) * 0.07 : 0
    const cabX = post.cabeza[0] + mirada.y * 0.2 + asiente - sorpresa * 0.14
    const cabY = mirada.x * 0.5
    const cabZ = post.cabeza[1] - mirada.x * 0.06 + saludo * 0.13 + Math.sin(t * 1.1) * 0.012
    H.cuello.rotation.set(cabX * 0.3, cabY * 0.3, cabZ * 0.3)
    H.cabeza.rotation.set(cabX * 0.7, cabY * 0.7, cabZ * 0.7)

    // Orejas: dos muelles por eje (base y punta). La punta persigue a la base, así que llega tarde y se pasa:
    // eso da el latigazo. La inercia sale de cuánto se movieron el cuerpo y la cabeza en este fotograma.
    const inv = 1 / Math.max(dt, 1e-3)
    const vx = (x - previo.x) * inv
    const vy = (y - previo.y) * inv
    const vCabY = (cabY - previo.cabY) * inv
    const vCabX = (cabX - previo.cabX) * inv
    Object.assign(previo, { x, y, cabY, cabX })
    for (const [lado, o, objetivo, huesos] of [[-1, orejas.I, post.oI, H.oI], [1, orejas.D, post.oD, H.oD]]) {
      const fase = lado * 0.9
      let ox = objetivo[0] + Math.sin(t * 0.8 + fase) * 0.02 - sorpresa * 0.14
      let oz = (objetivo[1] + Math.sin(t * 0.6 + fase * 2) * 0.025 - sorpresa * 0.12) * -lado
      if (lado === 1 && saludo > 0) {
        // No tiene brazos: saluda con la oreja.
        oz += saludo * (-0.55 + Math.sin(t * 15) * 0.3)
        ox -= saludo * 0.1
      }
      o.bx.v += (vCabX * 1.4 + vy * 0.5) * dt * 30
      o.bz.v += (vx * 0.8 - vCabY * lado * 0.25) * dt * 30
      muelle(o.bx, ox, dt, 90, 9)
      muelle(o.bz, oz, dt, 90, 9)
      // La base apenas gira (la cruza la diadema de los auriculares); la curva crece hacia la punta.
      let ax = o.bx.x
      let az = o.bz.x
      for (let k = 0; k < SEGMENTOS_OREJA; k++) {
        ax = o.x[k] = tender(o.x[k], ax, dt, 26 - k * 1.1)
        az = o.z[k] = tender(o.z[k], az, dt, 26 - k * 1.1)
        const reparto = k < 2 ? 0.04 : 0.07 + k * 0.016
        huesos[k].rotation.set(ax * reparto, 0, az * reparto)
      }
    }
    // La capucha llega tarde a los giros de la cabeza.
    H.capucha.rotation.set(tender(H.capucha.rotation.x, -vCabX * 0.05 + respira * 0.006, dt, 5), 0, tender(H.capucha.rotation.z, vCabY * 0.04, dt, 5))

    // El pelo se queda atrás cuando el conejo se mueve y lo peina una brisa muy leve.
    const m = compartido.mecer.value
    m.set(
      tender(m.x, Math.max(-0.02, Math.min(0.02, -vx * 0.004 - vCabY * 0.004)) + Math.sin(t * 1.3) * 0.0015, dt, 7),
      tender(m.y, Math.max(-0.02, Math.min(0.02, -vy * 0.004)) - 0.003, dt, 7),
      tender(m.z, Math.sin(t * 0.9) * 0.001, dt, 7)
    )

    // Luz del estado: contraluz, ojos y orbe.
    colorLuz.lerp(colorMeta, 1 - Math.exp(-dt * 5))
    compartido.luz.value.copy(colorLuz)
    contraCian.color.copy(colorLuz)
    const [oBase, oVaiven, oRitmo] = P.orbe
    post.orbe = tender(post.orbe, oBase + oVaiven * Math.sin(t * oRitmo * Math.PI * 2), dt, 12)
    const brillo = post.orbe + pulso * 2.2 + sorpresa * 1.5
    cuerpo.material.emissiveIntensity = brillo
    luzOrbe.color.copy(colorLuz).lerp(contraVioleta.color, 0.4)
    luzOrbe.intensity = brillo * 0.9

    // Ojos: solo se repintan si algo cambió.
    if (t > proximoParpadeo) { proximoParpadeo = t + 2.2 + Math.random() * 4; parpadeo = 0 }
    parpadeo = Math.min(1, parpadeo + dt * 8)
    const forma = saludo > 0.15 ? 'feliz' : 'normal'
    const ojo = {
      forma, color: `#${colorLuz.getHexString()}`, apertura: post.apertura * (0.15 + 0.85 * suave(parpadeo)),
      pupila: sorpresa > 0.05 ? 0.72 : 1, curva: post.curva, mx: mirada.x, my: mirada.y, brillo: 1 + pulso
    }
    const firma = `${forma}|${ojo.color}|${ojo.apertura.toFixed(2)}|${ojo.pupila}|${ojo.curva.toFixed(2)}|${ojo.mx.toFixed(2)}|${ojo.my.toFixed(2)}|${pulso.toFixed(1)}`
    if (firma !== firmaOjos) {
      firmaOjos = firma
      for (const l of lentes) {
        dibujarOjo(l.ctx, l.lienzo.width, l.lienzo.height, ojo)
        l.textura.needsUpdate = true
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Bucle: se para con la pestaña oculta o el lienzo fuera de pantalla, y mide los fps para bajar calidad.
  // ---------------------------------------------------------------------------------------------
  let enMarcha = false
  let visible = true
  let idRaf = 0
  let ultimo = 0
  let cuadros = 0
  let marca = 0
  let lentos = 0
  let alBajar = () => {}
  function cuadro(ahora) {
    idRaf = requestAnimationFrame(cuadro)
    const dt = Math.max(0, Math.min(0.05, (ahora - ultimo) / 1000))
    ultimo = ahora
    redimensionar()
    actualizar(dt)
    renderer.render(escena, camara)
    cuadros++
    if (ahora - marca > 1500) {
      const fps = (cuadros * 1000) / (ahora - marca)
      cuadros = 0
      marca = ahora
      lentos = fps < 44 ? lentos + 1 : 0
      if (lentos >= 2 && nivel < CALIDAD.length - 1) {
        lentos = 0
        fijarCalidad(nivel + 1)
        alBajar(nivel)
      }
    }
  }
  function arrancar() {
    if (idRaf || !enMarcha || !visible || document.hidden) return
    ultimo = marca = performance.now()
    cuadros = lentos = 0
    idRaf = requestAnimationFrame(cuadro)
  }
  function parar() {
    cancelAnimationFrame(idRaf)
    idRaf = 0
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? parar() : arrancar()))

  fijarCalidad(nivel)

  return {
    /** Encuadre objetivo, en fracciones de la ventana: x (centro), alto (del conejo), base (su pie), giro, camY. */
    pose(p) { Object.assign(poseMeta, p) },
    estado(id) {
      if (!POSTURA[id] || id === estado) return
      estado = id
      colorMeta.set(COLOR_ESTADO[id])
      pulso = Math.min(1, pulso + 0.5)
    },
    /** Posición del cursor o del dedo, en coordenadas de ventana. */
    mirar(clientX, clientY) {
      const r = lienzo.getBoundingClientRect()
      puntero.x = ((clientX - r.left) / r.width) * 2 - 1
      puntero.y = -(((clientY - r.top) / r.height) * 2 - 1)
      puntero.cuando = t
    },
    /** Giroscopio: inclinación ya normalizada a −1…1. */
    inclinar(nx, ny) {
      centroCabeza.setFromMatrixPosition(H.cabeza.matrixWorld).project(camara)
      puntero.x = centroCabeza.x + nx
      puntero.y = centroCabeza.y + 0.25 * pose.alto + ny
      puntero.cuando = t
    },
    /** Clic o toque: si cae sobre el conejo, reacciona (alterna saludo y sorpresa) y devuelve true. */
    tocar(clientX, clientY) {
      const r = lienzo.getBoundingClientRect()
      const nx = ((clientX - r.left) / r.width) * 2 - 1
      const ny = -(((clientY - r.top) / r.height) * 2 - 1)
      const centro = new Vector3(0, 0, 0).applyMatrix4(pivote.matrixWorld).project(camara)
      const ry = pose.alto
      const rx = (pose.alto * 0.62) / camara.aspect
      if (((nx - centro.x) / rx) ** 2 + ((ny - centro.y) / ry) ** 2 > 1) return false
      const id = turnoToque++ % 2 === 0 ? 'saludo' : 'sorpresa'
      gesto = { id, inicio: t, dura: id === 'saludo' ? 1.9 : 0.85 }
      pulso = 1
      return true
    },
    activo(si) { enMarcha = si; si ? arrancar() : parar() },
    visible(si) { visible = si; si ? arrancar() : parar() },
    alBajarCalidad(f) { alBajar = f },
    /** Dibuja un fotograma suelto en una pose fija (sin bucle). */
    fotograma(segundos = 0) {
      redimensionar()
      poseLista = false
      actualizar(0.016)
      for (let i = 0; i < segundos * 60; i++) actualizar(1 / 60)
      renderer.render(escena, camara)
    },
    get color() { return `#${colorLuz.getHexString()}` },
    get centroX() { return 0.5 + pose.x }
  }
}
