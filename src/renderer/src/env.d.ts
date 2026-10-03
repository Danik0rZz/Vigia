/// <reference types="vite/client" />

import type { VigiaApi } from '@shared/ipc'

declare global {
  interface Window {
    /** API expuesta por el preload; la interfaz no tiene otro acceso a main. */
    vigia: VigiaApi
  }
}
