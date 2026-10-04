import type { ApiOrbe } from '../shared/tipos'

declare global {
  interface Window {
    orbe: ApiOrbe
  }
}

export {}
