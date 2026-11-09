import { powerMonitor } from 'electron'
import type { EventoEntorno } from '../shared/tipos'

/** Sin tocar teclado ni ratón tanto tiempo, el personaje entiende que te fuiste (y se duerme). */
export const AUSENTE_SEGUNDOS = 4 * 60
const INTERVALO_MS = 10_000

/** Lo poco del sistema que hace falta (en las pruebas se sustituye). */
export interface FuenteSistema {
  segundosInactivo(): number
  alEvento(nombre: 'lock-screen' | 'unlock-screen' | 'suspend' | 'resume' | 'on-battery' | 'on-ac', cb: () => void): void
}

/**
 * Vigila el entorno del equipo, sin leer nada tuyo: solo cuánto llevas sin tocar el teclado o el ratón, si bloqueas la
 * pantalla, si el equipo se suspende y si pasa a batería. El personaje reacciona: se duerme si te vas, se alegra al
 * verte volver, se preocupa al quedarse sin enchufe.
 */
export class Vigia {
  private ausente = false
  private temporizador: NodeJS.Timeout | null = null

  constructor(
    private readonly avisar: (evento: EventoEntorno) => void,
    private readonly fuente: FuenteSistema = {
      segundosInactivo: () => powerMonitor.getSystemIdleTime(),
      alEvento: (nombre, cb) => powerMonitor.on(nombre as 'lock-screen', cb)
    }
  ) {}

  iniciar(): void {
    const f = this.fuente
    f.alEvento('lock-screen', () => this.marcar(true, 'bloqueo'))
    f.alEvento('unlock-screen', () => this.marcar(false, 'desbloqueo'))
    f.alEvento('suspend', () => this.marcar(true, 'suspension'))
    f.alEvento('resume', () => this.marcar(false, 'reanudacion'))
    f.alEvento('on-battery', () => this.avisar('bateria'))
    f.alEvento('on-ac', () => this.avisar('corriente'))
    this.temporizador = setInterval(() => this.revisar(), INTERVALO_MS)
    this.temporizador.unref?.()
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador)
    this.temporizador = null
  }

  /** Mira cuánto llevas sin tocar nada: pasar el umbral es «te fuiste»; tocar algo después, «volviste». */
  revisar(): void {
    const inactivo = this.fuente.segundosInactivo()
    if (!this.ausente && inactivo >= AUSENTE_SEGUNDOS) this.marcar(true, 'ausente')
    else if (this.ausente && inactivo < INTERVALO_MS / 1000) this.marcar(false, 'vuelve')
  }

  private marcar(ausente: boolean, evento: EventoEntorno): void {
    const cambia = ausente !== this.ausente
    this.ausente = ausente
    // Bloquear o suspender siempre se avisa; «ausente» y «vuelve» solo cuando cambia de verdad.
    if (cambia || evento === 'bloqueo' || evento === 'suspension') this.avisar(evento)
  }
}
