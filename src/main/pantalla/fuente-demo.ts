import type { ContenidoUia, FuenteUia, TextoUia, VentanaUia } from './contexto'

export type EscenarioDemo = 'contenido' | 'seleccion' | 'poco' | 'vacio' | 'sin_ventana' | 'error'

const RECETA = `Receta de tortilla de patatas
Ingredientes: seis huevos, cuatro patatas medianas, una cebolla, aceite de oliva y sal.
Pela y corta las patatas en láminas finas y pocha las patatas con la cebolla a fuego lento durante veinte minutos.
Bate los huevos con una pizca de sal y mezcla con las patatas escurridas.
Cuaja la tortilla en una sartén por ambos lados; da la vuelta con la ayuda de un plato.
Déjala reposar unos minutos antes de servir. Se puede comer templada o fría.`

/** Fuente de pantalla de mentira para las pruebas visuales (--smoke): nunca toca la pantalla real del usuario. */
export class FuenteDemo implements FuenteUia {
  escenario: EscenarioDemo = 'contenido'

  async ventana(): Promise<VentanaUia | null> {
    if (this.escenario === 'error') throw new Error('El lector de prueba falló a propósito.')
    if (this.escenario === 'sin_ventana') return null
    return {
      hwnd: 1,
      pid: 1,
      proceso: 'chrome',
      aplicacion: 'Google Chrome',
      titulo: 'Receta de tortilla - Cocina fácil',
      esNavegador: true,
      url: 'https://example.com/recetas/tortilla?utm_source=correo&sesion=abc123',
      barra: null,
      primerPlano: true,
      restringida: false
    }
  }

  async seleccion(): Promise<TextoUia> {
    if (this.escenario === 'seleccion') {
      return { texto: 'Cuaja la tortilla en una sartén por ambos lados; da la vuelta con la ayuda de un plato.', metodo: 'foco' }
    }
    return { texto: null, metodo: null }
  }

  async contenido(): Promise<ContenidoUia> {
    switch (this.escenario) {
      case 'contenido':
        return { texto: RECETA, metodo: 'documento', parcial: false }
      case 'poco':
        return { texto: 'Archivo\nEditar\nVer\nAyuda', metodo: 'arbol', parcial: false }
      default:
        return { texto: null, metodo: null, parcial: false }
    }
  }
}
