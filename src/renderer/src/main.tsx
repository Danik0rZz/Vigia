import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initI18n } from './app/i18n'
import { initTheme } from './app/theme'
import { queryClient } from './data/tenants'
import { setErrorLogVersion } from './lib/error-log'
import { invoke } from './lib/ipc'
import { enableRenderCount } from './lib/render-count'

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

/** Lo más que se espera a `app:getInfo` antes del primer render (ficha 0064). */
const APP_INFO_TIMEOUT_MS = 2000

/**
 * Antes del primer render, main dice si el disparador de errores está
 * habilitado (solo en e2e) y la versión que acompaña a los errores en el log.
 * El mismo modo e2e activa el contador de renders de las filas (ficha 0059).
 * Si el IPC falla o no responde en 2 s, la app arranca igual, sin disparador.
 * La respuesta se deja en la caché (`appInfo`): la barra lateral no vuelve a pedirla.
 */
async function start(root: HTMLElement): Promise<void> {
  let errorTrigger = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), APP_INFO_TIMEOUT_MS)
  })
  const request = invoke('app:getInfo').then((info) => {
    // Aunque llegue tarde, sirve a la barra lateral (versión y si va empaquetada).
    queryClient.setQueryData(['appInfo'], info)
    return info
  })
  try {
    const info = await Promise.race([request, timeout])
    if (info !== null) {
      errorTrigger = info.errorTrigger
      if (errorTrigger) enableRenderCount()
      setErrorLogVersion(info.version)
    }
  } catch {
    // Sin datos de main: valores por defecto.
  } finally {
    clearTimeout(timer)
  }
  // Si falla después del tiempo máximo, no queda una promesa rechazada sin recoger.
  request.catch(() => undefined)
  createRoot(root).render(
    <StrictMode>
      <App errorTrigger={errorTrigger} />
    </StrictMode>
  )
}

void start(container)
