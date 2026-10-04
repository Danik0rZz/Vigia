import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initI18n } from './app/i18n'
import { initTheme } from './app/theme'
import { setErrorLogVersion } from './lib/error-log'
import { invoke } from './lib/ipc'

const container = document.getElementById('root')
if (container === null) {
  throw new Error('Falta el elemento #root en index.html')
}

// Tema e idioma antes del primer render, para no mostrar un parpadeo.
initTheme()
initI18n()

// Las rutas son hash: sin hash, se arranca en Inicio (`#/`).
if (window.location.hash === '') {
  window.history.replaceState(null, '', '#/')
}

/**
 * Antes del primer render, main dice si el disparador de errores está
 * habilitado (solo en e2e) y la versión que acompaña a los errores en el log.
 * Si el IPC falla, la app arranca igual, sin disparador.
 */
async function start(root: HTMLElement): Promise<void> {
  let errorTrigger = false
  try {
    const info = await invoke('app:getInfo')
    errorTrigger = info.errorTrigger
    setErrorLogVersion(info.version)
  } catch {
    // Sin datos de main: valores por defecto.
  }
  createRoot(root).render(
    <StrictMode>
      <App errorTrigger={errorTrigger} />
    </StrictMode>
  )
}

void start(container)
