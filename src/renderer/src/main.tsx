import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initI18n } from './app/i18n'
import { initTheme } from './app/theme'

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

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
