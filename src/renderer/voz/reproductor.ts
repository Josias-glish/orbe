import type { Reproductor } from './lector'

/** Reproduce el audio de la voz neuronal con un elemento de audio del navegador; no se guarda nada en disco. */
export class ReproductorAudio implements Reproductor {
  private actual: HTMLAudioElement | null = null
  private terminar: (() => void) | null = null

  reproducir(audio: Uint8Array, mime: string, velocidad: number): Promise<void> {
    return new Promise<void>((resolver) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(audio)], { type: mime }))
      const elemento = new Audio(url)
      elemento.playbackRate = velocidad
      const fin = (): void => {
        URL.revokeObjectURL(url)
        if (this.actual === elemento) {
          this.actual = null
          this.terminar = null
        }
        resolver()
      }
      elemento.onended = fin
      elemento.onerror = fin
      this.actual = elemento
      this.terminar = fin
      elemento.play().catch(fin)
    })
  }

  /** Corta el audio que esté sonando. */
  parar(): void {
    const elemento = this.actual
    if (!elemento) return
    elemento.pause()
    this.terminar?.()
  }
}
