// Portada de Orbe: decide si hay 3D, lo carga en diferido y une el scroll, el cursor y la pista de estados
// con el conejo. Sin WebGL, con «reducir movimiento» o si la carga falla, la página se queda con el póster.

const raiz = document.documentElement
const tramos = [...document.querySelectorAll('.tramo[data-estado]')]
const pista = document.querySelector('.pista')
const teclas = [...pista.querySelectorAll('button')]
const carga = document.querySelector('.carga')

// Encuadre del conejo en cada tramo, en fracciones de la ventana: x (0 = centro), alto, base (su pie), giro, camY.
const POSES = {
  ancha: [
    { x: 0, alto: 0.84, base: -0.06, giro: 0, camY: 0 },
    { x: 0.23, alto: 0.74, base: 0.02, giro: -0.42, camY: 0.02 },
    { x: 0.25, alto: 0.94, base: -0.16, giro: -0.28, camY: 0.02 },
    { x: -0.23, alto: 0.76, base: 0, giro: 0.4, camY: 0 },
    { x: -0.24, alto: 0.8, base: -0.02, giro: 0.45, camY: 0 },
    { x: -0.21, alto: 1.14, base: -0.36, giro: 0.3, camY: -0.02 },
    { x: 0.24, alto: 0.9, base: -0.1, giro: -0.5, camY: 0.03 },
    { x: 0.22, alto: 0.8, base: 0, giro: -0.22, camY: 0 }
  ],
  estrecha: [
    { x: 0, alto: 0.5, base: 0.4, giro: 0, camY: 0 },
    { x: 0, alto: 0.42, base: 0.52, giro: -0.3, camY: 0 },
    { x: 0, alto: 0.5, base: 0.44, giro: 0.24, camY: 0 },
    { x: 0, alto: 0.42, base: 0.52, giro: -0.2, camY: 0 },
    { x: 0, alto: 0.42, base: 0.52, giro: 0.32, camY: 0 },
    { x: 0, alto: 0.56, base: 0.4, giro: 0.2, camY: 0 },
    { x: 0, alto: 0.44, base: 0.5, giro: -0.34, camY: 0 },
    { x: 0, alto: 0.42, base: 0.52, giro: 0, camY: 0 }
  ]
}

const suave = (p) => p * p * (3 - 2 * p)
const mezclar = (a, b, f) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + (b[k] - a[k]) * f]))

function hayWebGL() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

async function iniciar() {
  const lienzo = document.getElementById('lienzo')
  raiz.classList.add('vivo')
  carga.hidden = false
  let escena
  try {
    const { crearEscena } = await import('./escena.js')
    escena = await crearEscena(lienzo, {
      calidad: matchMedia('(max-width: 52rem)').matches ? 1 : 0,
      alAvanzar: (p) => carga.style.setProperty('--carga', p.toFixed(3))
    })
  } catch (error) {
    // Sin 3D la página sigue completa: vuelve al póster.
    console.warn('Orbe: no se pudo iniciar el 3D.', error)
    raiz.classList.remove('vivo')
    carga.hidden = true
    return
  }
  carga.hidden = true
  pista.hidden = false

  let forzado = null // estado elegido en la pista, mientras dure
  let finForzado = 0
  let pendiente = false

  function situar() {
    pendiente = false
    const vh = innerHeight
    const medio = vh * 0.55
    const centros = tramos.map((t) => {
      const r = t.getBoundingClientRect()
      return r.top + r.height / 2
    })
    // Entre qué dos tramos está el centro de la ventana, y cuánto ha avanzado de uno a otro.
    let i = 0
    while (i < centros.length - 2 && centros[i + 1] < medio) i++
    const f = Math.min(1, Math.max(0, (medio - centros[i]) / (centros[i + 1] - centros[i])))
    const estrecha = innerWidth < 832 || innerWidth / vh < 0.95
    const poses = estrecha ? POSES.estrecha : POSES.ancha
    const pose = mezclar(poses[i], poses[i + 1], suave(f))
    // Entre tableta y escritorio el conejo se aparta para no pisar el texto de la portada.
    if (!estrecha && innerWidth / vh < 1.55) pose.x += (1 - i - f > 0 ? 1 - i - f : 0) * 0.17
    escena.pose(pose)

    const actual = f < 0.5 ? i : i + 1
    const estado = forzado ?? tramos[actual].dataset.estado
    escena.estado(estado)
    raiz.dataset.estado = estado
    raiz.style.setProperty('--penumbra', Math.min(0.9, scrollY / (vh * 0.75)).toFixed(3))
    raiz.style.setProperty('--cx', `${(escena.centroX * 100).toFixed(1)}%`)
    // La luz de la pista va de la tecla del tramo actual a la del siguiente (hay más tramos que estados).
    const tecla = (n) => teclas.findIndex((t) => t.dataset.estado === tramos[n].dataset.estado)
    pista.style.setProperty('--avance', (tecla(i) + (tecla(i + 1) - tecla(i)) * f).toFixed(3))
    pista.dataset.actual = teclas.find((t) => t.dataset.estado === estado)?.textContent ?? ''
    for (const t of teclas) t.setAttribute('aria-pressed', String(t.dataset.estado === estado))
  }
  const pedir = () => {
    if (!pendiente) {
      pendiente = true
      requestAnimationFrame(situar)
    }
  }
  addEventListener('scroll', pedir, { passive: true })
  addEventListener('resize', pedir)

  // La pista: cada tecla muestra su estado unos segundos; al seguir bajando manda otra vez el scroll.
  for (const tecla of teclas) {
    tecla.addEventListener('click', () => {
      forzado = tecla.dataset.estado
      clearTimeout(finForzado)
      finForzado = setTimeout(() => { forzado = null; pedir() }, 6000)
      pedir()
    })
  }

  // Mirada: cursor, dedo o, si el teléfono lo da sin pedir permiso, el giroscopio.
  addEventListener('pointermove', (e) => escena.mirar(e.clientX, e.clientY), { passive: true })
  addEventListener('pointerdown', (e) => escena.mirar(e.clientX, e.clientY), { passive: true })
  if (matchMedia('(pointer: coarse)').matches) {
    addEventListener('deviceorientation', (e) => {
      if (e.gamma == null || e.beta == null) return
      escena.inclinar(Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, (45 - e.beta) / 30)))
    }, { passive: true })
  }

  // Toque: reacciona solo si se pulsa al conejo y no un enlace, un botón o texto seleccionable encima.
  addEventListener('click', (e) => {
    if (e.target.closest('a, button, .texto, .entrada, .cabecera, .pie')) return
    escena.tocar(e.clientX, e.clientY)
  })

  // Fuera de pantalla (al llegar al pie) o con la pestaña oculta, no se dibuja.
  new IntersectionObserver(([entrada]) => escena.visible(entrada.isIntersecting)).observe(lienzo)

  situar()
  escena.fotograma()
  escena.activo(true)
  raiz.classList.add('cargado')
}

if (hayWebGL() && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  // Carga diferida: primero se pinta la página con el póster; el 3D llega después.
  if ('requestIdleCallback' in window) requestIdleCallback(iniciar, { timeout: 1500 })
  else setTimeout(iniciar, 200)
}
