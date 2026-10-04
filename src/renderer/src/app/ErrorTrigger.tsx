import { useEffect, type JSX } from 'react'
import { useLocation, useParams } from 'react-router'
import { PanelBoundary } from '../components/PanelBoundary'
import { FATAL_TRIGGER_EVENT } from './AppErrorBoundary'

/**
 * 'once' falla en la primera navegación a la ruta y ya no en las siguientes:
 * así se prueba que Reintentar (que navega de nuevo) recupera. Va por la clave
 * de la navegación y no por render, porque React repite el render que falla.
 */
let failingKey: string | null = null

function failsFor(navigationKey: string): boolean {
  failingKey ??= navigationKey
  return failingKey === navigationKey
}

function Thrower(): JSX.Element {
  throw new Error('Error de prueba del disparador (panel)')
}

/** Pide el error de arriba del todo (AppErrorBoundary) en cuanto se monta. */
function FatalRequest(): JSX.Element {
  useEffect(() => {
    window.dispatchEvent(new Event(FATAL_TRIGGER_EVENT))
  }, [])
  return <div data-testid="error-trigger-page" className="min-h-10" />
}

/**
 * Provoca cada pantalla de error (solo en modo e2e, ver buildRoutes): así se
 * prueban y se pueden ver en desarrollo. 'panel' deja la página viva con un
 * panel roto; 'fatal' falla por encima del router; 'chunk' imita un trozo de
 * la interfaz que no se pudo cargar; el resto, un error inesperado.
 */
export function ErrorTrigger(): JSX.Element {
  const { variant = '' } = useParams()
  const location = useLocation()
  if (variant === 'panel') {
    return (
      <div data-testid="error-trigger-page" className="grid gap-4">
        <PanelBoundary>
          <Thrower />
        </PanelBoundary>
      </div>
    )
  }
  if (variant === 'fatal') return <FatalRequest />
  if (variant === 'once') {
    if (failsFor(location.key)) throw new Error('Error de prueba del disparador (once)')
    // Con alto: una página vacía no se "ve" en los e2e.
    return <div data-testid="error-trigger-page" className="min-h-10" />
  }
  if (variant === 'chunk') {
    throw new TypeError(
      'Failed to fetch dynamically imported module: app://vigia/assets/prueba-disparador.js'
    )
  }
  // Con una ruta de usuario inventada: el e2e comprueba que los detalles la tapan.
  throw new Error(
    `Error de prueba del disparador (${variant}) en C:\\Users\\persona-prueba\\vigia\\x.js`
  )
}
