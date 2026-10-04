import { useEffect, type JSX } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router'
import { isChunkLoadError } from '@shared/error-report'
import { ErrorScreen } from '../components/ErrorScreen'
import type { ErrorVariant, UpdatedReason } from '../lib/error-details'
import { canAutoReload, sessionStore, shouldAutoReload } from '../lib/chunk-reload'
import { reportError } from '../lib/error-log'
import { isRecentHotUpdate, lastHotUpdate } from '../lib/hot-update'

interface Decision {
  variant: ErrorVariant
  reason: UpdatedReason
  countdown: boolean
}

// Una decisión por error: la pantalla no cambia de variante si se vuelve a pintar.
const decisions = new WeakMap<object, Decision>()

function decide(error: unknown): Decision {
  if (isRouteErrorResponse(error) && error.status === 404) {
    return { variant: 'notFound', reason: 'chunk', countdown: false }
  }
  // Solo en desarrollo: justo tras una recarga en caliente, el código está a medias.
  if (isRecentHotUpdate(lastHotUpdate(), Date.now())) {
    return { variant: 'updated', reason: 'hot', countdown: false }
  }
  if (isChunkLoadError(error)) {
    return canAutoReload(sessionStore(), Date.now())
      ? { variant: 'updated', reason: 'chunk', countdown: true }
      : { variant: 'unexpected', reason: 'chunk', countdown: false }
  }
  return { variant: 'unexpected', reason: 'chunk', countdown: false }
}

function decideOnce(error: unknown): Decision {
  if (typeof error !== 'object' || error === null) return decide(error)
  const known = decisions.get(error)
  if (known !== undefined) return known
  const decision = decide(error)
  decisions.set(error, decision)
  return decision
}

/**
 * errorElement del router: en la raíz (si falla el propio layout) y en cada
 * ruta (el error ocupa el área de contenido y el menú sigue). Decide la
 * variante, lo manda al log una vez y ofrece salir.
 */
export function RouteError(): JSX.Element {
  const error = useRouteError()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const route = `${location.pathname}${location.search}`
  const decision = decideOnce(error)

  useEffect(() => {
    if (decision.variant !== 'notFound') reportError(error, route)
  }, [error, route, decision.variant])

  // Al enseñar la cuenta atrás se deja la marca anti-bucle (con o sin recarga):
  // otro fallo de este tipo en menos de 60 s ya enseña el error con detalles.
  useEffect(() => {
    if (decision.countdown) shouldAutoReload(sessionStore(), Date.now())
  }, [decision.countdown])

  // Reintentar: datos de nuevo y una navegación a la misma ruta, que limpia el error.
  const retry = (): void => {
    void queryClient.refetchQueries({ type: 'active' })
    void navigate(route, { replace: true })
  }

  return (
    <div className="grid min-h-full place-items-center p-6">
      <ErrorScreen
        variant={decision.variant}
        reason={decision.reason}
        countdown={decision.countdown}
        error={error}
        route={route}
        onRetry={retry}
        onHome={() => void navigate('/')}
      />
    </div>
  )
}

/** Ruta que no existe: el 404 propio, dentro del layout. */
export function NotFound(): JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <div className="grid min-h-full place-items-center p-6">
      <ErrorScreen
        variant="notFound"
        route={`${location.pathname}${location.search}`}
        onHome={() => void navigate('/')}
      />
    </div>
  )
}
