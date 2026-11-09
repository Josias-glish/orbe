import { Box3, type Material, type Mesh, MeshStandardMaterial, RepeatWrapping, Texture, type WebGLProgramParametersWithUniforms } from 'three'

export interface OpcionesDetalle {
  pelo?: Texture
  tejido?: Texture
  /** Altura del cuello (fracción desde abajo): por debajo es ropa. */
  cuello: number
  /** Franja de las gafas (fracciones desde abajo y del ancho), donde no va pelo. */
  gafas: { y0: number; y1: number; x: number }
}

/** Crea una textura repetible de detalle a partir de un JPEG (en gris). */
export async function texturaDetalle(bytes: Uint8Array): Promise<Texture> {
  const mapa = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
  const t = new Texture(mapa)
  t.wrapS = t.wrapT = RepeatWrapping
  t.needsUpdate = true
  return t
}

/**
 * Añade al material del modelo el detalle fino que una textura horneada de 2K no tiene de cerca: mechones de pelo en
 * la cabeza y las orejas y el punto del tejido en la sudadera. Se proyecta desde tres lados (sin depender de las UV
 * del modelo), solo en las zonas oscuras (no toca los auriculares blancos ni el orbe del pecho) y fuera de las gafas.
 * El pelo además pierde el brillo de plástico.
 */
export function aplicarDetalle(malla: Mesh, o: OpcionesDetalle): void {
  if (!o.pelo && !o.tejido) return
  malla.geometry.computeBoundingBox()
  const caja = malla.geometry.boundingBox ?? new Box3()
  const min = caja.min.clone()
  const tam = caja.getSize(min.clone())
  const materiales = (Array.isArray(malla.material) ? malla.material : [malla.material]) as Material[]
  for (const mat of materiales) {
    if (!(mat instanceof MeshStandardMaterial)) continue
    mat.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms) => {
      sh.uniforms['uPelo'] = { value: o.pelo ?? o.tejido }
      sh.uniforms['uTejido'] = { value: o.tejido ?? o.pelo }
      sh.uniforms['uFuerzaPelo'] = { value: o.pelo ? 0.32 : 0 }
      sh.uniforms['uFuerzaTejido'] = { value: o.tejido ? 0.22 : 0 }
      sh.uniforms['uMin'] = { value: min }
      sh.uniforms['uTam'] = { value: tam }
      sh.uniforms['uCuello'] = { value: o.cuello }
      sh.uniforms['uGafas'] = { value: [o.gafas.y0, o.gafas.y1, o.gafas.x] }
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDetPos;\nvarying vec3 vDetNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDetPos = position;\nvDetNormal = normal;')
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vDetPos;
varying vec3 vDetNormal;
uniform sampler2D uPelo;
uniform sampler2D uTejido;
uniform float uFuerzaPelo;
uniform float uFuerzaTejido;
uniform vec3 uMin;
uniform vec3 uTam;
uniform float uCuello;
uniform vec3 uGafas;
float detTriplanar(sampler2D tex, vec3 p, vec3 n, float rep) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z + 1e-5);
  return texture2D(tex, p.zy * rep).r * w.x + texture2D(tex, p.xz * rep).r * w.y + texture2D(tex, p.xy * rep).r * w.z;
}
float detPeloZona;`
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
{
  vec3 pn = (vDetPos - uMin) / max(uTam.y, 1e-5);
  float hN = pn.y;
  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  float oscuro = 1.0 - smoothstep(0.1, 0.26, lum);
  float ropa = 1.0 - smoothstep(uCuello - 0.02, uCuello + 0.02, hN);
  float xRel = abs(vDetPos.x - (uMin.x + uTam.x * 0.5)) / max(uTam.x, 1e-5);
  float gafas = step(uGafas.x, hN) * step(hN, uGafas.y) * (1.0 - step(uGafas.z, xRel));
  float pelo = (1.0 - ropa) * (1.0 - gafas) * oscuro;
  float tejido = ropa * oscuro;
  // Pelo corto y denso, como el de un conejo de verdad: muchas repeticiones y un toque suave.
  float dPelo = detTriplanar(uPelo, pn, normalize(vDetNormal), 18.0);
  float dTejido = detTriplanar(uTejido, pn, normalize(vDetNormal), 13.0);
  diffuseColor.rgb += pelo * (dPelo - 0.07) * uFuerzaPelo * vec3(0.92, 0.95, 1.08);
  diffuseColor.rgb += tejido * (dTejido - 0.7) * uFuerzaTejido;
  diffuseColor.rgb = max(diffuseColor.rgb, vec3(0.0));
  detPeloZona = pelo;
}`
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.95, detPeloZona);')
    }
    mat.customProgramCacheKey = () => 'orbe-detalle'
    mat.needsUpdate = true
  }
}
