import type { Instagram } from '../conectores/instagram/cliente'

/** Una cuenta de mentira para la prueba de humo: seis publicaciones, una muy por encima de la media. */
export function instagramDemo(): Pick<Instagram, 'perfil' | 'publicaciones' | 'metricas'> {
  const tipos = ['reel', 'carrusel', 'imagen', 'reel', 'carrusel', 'imagen']
  return {
    perfil: async () => ({ usuario: 'demo.marca', nombre: 'Demo', tipo: 'BUSINESS', seguidores: 1200, seguidos: 300, publicaciones: 48 }),
    publicaciones: async () =>
      tipos.map((tipo, i) => ({ id: String(1000 + i), pie: `Publicación de prueba ${i + 1}`, tipo, enlace: `https://www.instagram.com/p/demo${i}/`, fecha: new Date(Date.now() - i * 2 * 86_400_000).toISOString(), meGusta: 40 + i, comentarios: 3 })),
    metricas: async (id) => {
      const estrella = id === '1000'
      return { views: estrella ? 9000 : 1500, reach: estrella ? 6000 : 900, likes: estrella ? 420 : 45, comments: estrella ? 38 : 3, shares: estrella ? 60 : 2, saved: estrella ? 95 : 4, total_interactions: estrella ? 613 : 54 }
    }
  }
}
