#version 300 es
precision highp float;

uniform vec2  uResolucion;   // tamaño del canvas en píxeles
uniform float uFase;         // deriva del ruido (ya integrada por velocidad en JS)
uniform float uFaseOnda;     // fase de las ondas rítmicas
uniform float uAmplitud;     // cuánto se deforma el contorno
uniform float uTurbulencia;  // 0 = suave, 1 = muy turbulento (más frecuencia y octavas)
uniform float uBarrido;      // progreso del destello 0..1, negativo = apagado
uniform float uEnergia;      // intensidad de las ondas al responder 0..1
uniform float uBrillo;       // intensidad del halo exterior
uniform float uAccion;       // intensidad de los arcos que giran por el borde (actuando) 0..1
uniform float uGiro;         // ángulo acumulado de esos arcos, en radianes

out vec4 salida;

const float PI = 3.14159265;

// Un arco con cabeza brillante y cola que se desvanece detrás: 1 en la cabeza (angulo = cabeza), 0 lejos.
float cometa(float angulo, float cabeza, float cola) {
  float da = mod(angulo - cabeza + PI, 2.0 * PI) - PI;   // -PI..PI, negativo = por detrás de la cabeza
  return da <= 0.0 ? exp(da * cola) : exp(-da * 18.0);
}

// Ruido simplex 3D (Ian McEwan, Ashima Arts; licencia MIT).
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Paleta: cian, violeta, añil profundo y un toque de magenta.
const vec3 CIAN    = vec3(0.133, 0.827, 0.933);
const vec3 VIOLETA = vec3(0.545, 0.361, 0.965);
const vec3 ANIL    = vec3(0.075, 0.090, 0.290);
const vec3 MAGENTA = vec3(0.850, 0.350, 0.900);

void main() {
  // Coordenadas centradas en el canvas, de -1 a 1.
  vec2 uv = (gl_FragCoord.xy / uResolucion) * 2.0 - 1.0;
  float r = length(uv);
  vec2 dir = r > 0.0001 ? uv / r : vec2(1.0, 0.0);

  // Contorno orgánico: el radio depende del ruido en la dirección del píxel.
  float frecuencia = 0.9 + uTurbulencia * 0.9;
  float n1 = snoise(vec3(dir * frecuencia, uFase));
  float n2 = snoise(vec3(dir * frecuencia * 2.0 + 7.0, uFase * 1.7)) * uTurbulencia * 0.45;
  float angulo = atan(dir.y, dir.x);
  float ondaContorno = sin(angulo * 3.0 + uFaseOnda * 0.6) * uEnergia * 0.035;
  float radio = 0.56 * (1.0 + uAmplitud * (n1 + 0.5 * n2)) + ondaContorno + uEnergia * 0.025;

  float ancho = fwidth(r) * 1.2;
  float cuerpo = 1.0 - smoothstep(radio - ancho, radio + ancho, r);

  // Esfera falsa: normal reconstruida a partir de la distancia al borde.
  float d = clamp(r / radio, 0.0, 1.0);
  float nz = sqrt(max(1.0 - d * d, 0.0));
  vec3 p = vec3(uv / radio, nz);

  // Campos de color que fluyen por el interior.
  float f = snoise(p * (0.75 + uTurbulencia * 0.6) + vec3(0.0, 0.0, uFase * 1.3));
  float g = snoise(p * (1.15 + uTurbulencia * 0.8) + vec3(3.1, 1.7, -uFase * 1.1));
  vec3 color = mix(ANIL, CIAN, smoothstep(-0.9, 0.9, f));
  color = mix(color, VIOLETA, smoothstep(-0.55, 0.55, g) * 0.9);
  color = mix(color, MAGENTA, smoothstep(0.35, 0.9, f * g * 2.0) * 0.3);

  // Ondas rítmicas hacia afuera desde el centro (respondiendo).
  float anillos = sin(d * 13.0 - uFaseOnda) * 0.5 + 0.5;
  color += mix(CIAN, vec3(1.0), 0.5) * anillos * anillos * uEnergia * 0.28 * (1.0 - d * 0.5);

  // Volumen: centro algo más claro, borde de Fresnel y un reflejo suave arriba a la izquierda.
  float fresnel = pow(1.0 - nz, 2.4);
  color *= 0.78 + 0.5 * nz;
  color += mix(CIAN, vec3(1.0), 0.55) * fresnel * 0.75;
  float reflejo = smoothstep(0.55, 0.0, length(p.xy - vec2(-0.32, 0.38))) * 0.28;
  color += vec3(reflejo);

  // Destello que recorre la esfera en diagonal (leyendo la pantalla).
  if (uBarrido >= 0.0) {
    float s = dot(uv, normalize(vec2(1.0, -1.0)));
    float posicion = mix(-0.75, 0.75, uBarrido);
    float banda = exp(-pow((s - posicion) * 7.0, 2.0));
    color += vec3(0.85, 0.97, 1.0) * banda * 0.9;
  }

  // Actuando: dos arcos de luz giran en sentidos opuestos por el borde, como un instrumento que trabaja.
  float arcos = 0.0;
  if (uAccion > 0.001) {
    float banda = smoothstep(radio * 0.78, radio * 0.95, r) * (1.0 - smoothstep(radio * 0.95, radio * 1.01, r));
    float banda2 = smoothstep(radio * 0.58, radio * 0.66, r) * (1.0 - smoothstep(radio * 0.66, radio * 0.74, r));
    arcos = cometa(angulo, uGiro, 2.1) * banda + 0.55 * cometa(angulo, PI - uGiro * 0.6, 3.0) * banda2;
    color += mix(CIAN, vec3(1.0), 0.65) * arcos * uAccion * 2.1;
  }

  // Halo exterior con caída exponencial.
  float fuera = max(r - radio, 0.0);
  float halo = exp(-fuera * 6.5) * (1.0 - cuerpo) * uBrillo;
  vec3 colorHalo = mix(VIOLETA, CIAN, 0.5 + 0.5 * n1);
  float bordeSuave = 1.0 - smoothstep(0.92, 1.0, r);   // evita que el halo se corte en el borde del canvas
  // El arco principal también deja luz fuera del cuerpo, para que se note a pequeño tamaño.
  halo += cometa(angulo, uGiro, 2.1) * exp(-fuera * 11.0) * (1.0 - cuerpo) * uAccion * 0.8;
  halo *= bordeSuave;

  // Alfa premultiplicado: cuerpo opaco + halo translúcido.
  vec3 rgb = color * cuerpo + colorHalo * halo;
  float alfa = clamp(cuerpo + halo * 0.9, 0.0, 1.0);
  salida = vec4(rgb, alfa);
}
