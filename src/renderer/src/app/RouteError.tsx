import { useEffect, type JSX } from 'react'
import { isRouteErrorResponse, useLocation, useNavigate, useRouteError } from 'react-router'
import { isChunkLoadError } from '@shared/error-report'
import { ErrorScreen } from '../components/ErrorScreen'
import type { ErrorVariant, UpdatedReason } from '../lib/error-details'
import { sessionStore, shouldAutoReload } from '../lib/chunk-reload'
import { reportError } from '../lib/error-log'
import { isRecentHotUpdate, lastHotUpdate } from '../lib/hot-update'

interface Decision {
  variant: ErrorVariant
  reason: UpdatedReason
  countdown: boolean
}

/**
 * Un mismo fallo llega varias veces seguidas (React repite el render que
 * falla, cada vez con un error nuevo, y el router vuelve a montar la pantalla).
 * Lo que se decidió para una ruta en este margen se reutiliza.
 */
const SAME_FAILURE_MS = 1000
let lastChunk: { route: string; at: number; countdown: boolean } | null = null

/**
 * Cuenta atrás para un trozo de la interfaz que falta: se deja la marca
 * anti-bucle (una sola vez por fallo) y solo hay cuenta atrás si se pudo
 * escribir. Sin marca (cuota llena, escritura bloqueada) no se evitaría un
 * bucle de recargas: entonces se enseña el error con sus detalles.
 */
function chunkCountdown(route: string, now: number): boolean {
  if (lastChunk !== null && lastChunk.route === route && now - lastChunk.at < SAME_FAILURE_MS) {
    return lastChunk.countdown
  }
  const countdown = shouldAutoReload(sessionStore(), now)
  lastChunk = { route, at: now, countdown }
  return countdown
}

// Una decisión por error: la pantalla no cambia de variante si se vuelve a pintar.
const decisions = new WeakMap<object, Decision>()

function decide(error: unknown, route: string): Decision {
  if (isRouteErrorResponse(error) && error.status === 404) {
    return { variant: 'notFound', reason: 'chunk', countdown: false }
  }
  // Solo en desarrollo: justo tras una recarga en caliente, el código está a medias.
  if (isRecentHotUpdate(lastHotUpdate(), Date.now())) {
    return { variant: 'updated', reason: 'hot', countdown: false }
  }
  if (isChunkLoadError(error)) {
    return chunkCountdown(route, Date.now())
      ? { variant: 'updated', reason: 'chunk', countdown: true }
      : { variant: 'unexpected', reason: 'chunk', countdown: false }
  }
  return { variant: 'unexpected', reason: 'chunk', countdown: false }
}

function decideOnce(error: unknown, route: string): Decision {
  if (typeof error !== 'object' || error === null) return decide(error, route)
  const known = decisions.get(error)
  if (known !== undefined) return known
  const decision = decide(error, route)
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
  const route = `${location.pathname}${location.search}`
  const decision = decideOnce(error, route)

  useEffect(() => {
    if (decision.variant !== 'notFound') reportError(error, route)
  }, [error, route, decision.variant])

  // Reintentar: una navegación a la misma ruta, que limpia el error y vuelve a pintar con la
  // caché. No pide datos (ADR-0004, ficha 0064): para eso está «Actualizar» de cada página.
  const retry = (): void => {
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
