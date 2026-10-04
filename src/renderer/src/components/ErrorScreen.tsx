import { useEffect, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { errorDetailsText, type ErrorVariant, type UpdatedReason } from '../lib/error-details'
import { errorLogVersion } from '../lib/error-log'
import { invoke } from '../lib/ipc'
import { Lighthouse, type LighthouseScene } from './Lighthouse'
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from './styles'

/** Error compacto de un panel (ver PanelBoundary), con el faro que se sacude. */
export function PanelError({ onRetry }: { onRetry: () => void }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      data-testid="panel-error"
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
    >
      <Lighthouse scene="shake" size={48} />
      <p className="text-sm">{t('errorScreen.panel.title')}</p>
      <button
        type="button"
        data-testid="panel-retry"
        onClick={onRetry}
        className={BUTTON_SECONDARY}
      >
        {t('errorScreen.retry')}
      </button>
    </div>
  )
}

/** Segundos antes de recargar sola cuando la interfaz ha cambiado. */
const COUNTDOWN_SECONDS = 5

const SCENES: Record<ErrorVariant, LighthouseScene> = {
  unexpected: 'bulb',
  updated: 'sweep',
  notFound: 'search'
}

function Details({ error, route }: { error: unknown; route: string }): JSX.Element {
  const { t } = useTranslation()
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle')
  const text = errorDetailsText(error, route, errorLogVersion())
  const copyDetails = (): void => {
    invoke('app:copyText', { text: text.slice(0, 20_000) })
      .then(() => setCopy('done'))
      .catch(() => setCopy('failed'))
  }
  return (
    // En desarrollo, abiertos: es lo primero que se quiere ver.
    <details data-testid="error-details" open={import.meta.env.DEV} className="w-full text-left">
      <summary className="cursor-pointer text-sm text-muted-foreground">
        {t('errorScreen.details')}
      </summary>
      <pre
        data-testid="error-details-text"
        className="mt-2 max-h-56 overflow-auto rounded-md bg-hover p-3 text-xs break-all whitespace-pre-wrap"
      >
        {text}
      </pre>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          data-testid="error-copy"
          onClick={copyDetails}
          className={BUTTON_SECONDARY}
        >
          {t('errorScreen.copy')}
        </button>
        {copy !== 'idle' && (
          <span
            data-testid="error-copy-status"
            role="status"
            className="text-xs text-muted-foreground"
          >
            {t(copy === 'done' ? 'errorScreen.copied' : 'errorScreen.copyFailed')}
          </span>
        )}
      </div>
    </details>
  )
}

/** Cuenta atrás hasta recargar; se puede parar. */
function Countdown({ onCancel }: { onCancel: () => void }): JSX.Element {
  const { t } = useTranslation()
  const [left, setLeft] = useState(COUNTDOWN_SECONDS)
  useEffect(() => {
    if (left <= 0) {
      window.location.reload()
      return
    }
    const timer = window.setTimeout(() => setLeft(left - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [left])
  return (
    <p className="flex items-center gap-3 text-sm text-muted-foreground">
      <span data-testid="error-countdown" role="timer" aria-live="polite">
        {t('errorScreen.updated.countdown', { count: left })}
      </span>
      <button
        type="button"
        data-testid="error-countdown-cancel"
        onClick={onCancel}
        className="text-sm underline underline-offset-2"
      >
        {t('errorScreen.updated.cancel')}
      </button>
    </p>
  )
}

/**
 * Pantalla de error con el faro: inesperado (Reintentar, Inicio y Recargar),
 * interfaz cambiada (Recargar, con cuenta atrás si es un trozo que falta) y 404
 * (Inicio). Los detalles técnicos van plegados y enmascarados. El foco va al
 * botón principal.
 */
export function ErrorScreen({
  variant,
  reason = 'chunk',
  error,
  route,
  countdown = false,
  onRetry,
  onHome
}: {
  variant: ErrorVariant
  reason?: UpdatedReason
  error?: unknown
  route: string
  /** updated: recargar sola tras la cuenta atrás. */
  countdown?: boolean
  onRetry?: () => void
  onHome: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const primary = useRef<HTMLButtonElement>(null)
  const [counting, setCounting] = useState(countdown)
  useEffect(() => primary.current?.focus(), [])

  const texts =
    variant === 'updated' && reason === 'hot'
      ? 'errorScreen.hot'
      : variant === 'updated'
        ? 'errorScreen.updated'
        : `errorScreen.${variant}`

  const reload = (
    <button
      ref={variant === 'updated' ? primary : undefined}
      type="button"
      data-testid="error-reload"
      onClick={() => window.location.reload()}
      className={variant === 'updated' ? BUTTON_PRIMARY : BUTTON_SECONDARY}
    >
      {t('errorScreen.reload')}
    </button>
  )
  const home = (
    <button
      ref={variant === 'notFound' ? primary : undefined}
      type="button"
      data-testid="error-home"
      onClick={onHome}
      className={variant === 'notFound' ? BUTTON_PRIMARY : BUTTON_SECONDARY}
    >
      {t('errorScreen.home')}
    </button>
  )

  return (
    <div
      data-testid="error-screen"
      data-variant={variant}
      data-reason={variant === 'updated' ? reason : undefined}
      role="alert"
      className="glass mx-auto grid max-w-xl justify-items-center gap-4 rounded-xl p-8 text-center"
    >
      <Lighthouse scene={SCENES[variant]} />
      <h1 className="text-lg font-semibold">{t(`${texts}.title`)}</h1>
      <p className="text-sm text-muted-foreground">{t(`${texts}.body`)}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {variant === 'unexpected' && (
          <>
            <button
              ref={primary}
              type="button"
              data-testid="error-retry"
              onClick={onRetry}
              className={BUTTON_PRIMARY}
            >
              {t('errorScreen.retry')}
            </button>
            {home}
            {reload}
          </>
        )}
        {variant === 'updated' && reload}
        {variant === 'notFound' && home}
      </div>
      {variant === 'updated' && reason === 'chunk' && counting && (
        <Countdown onCancel={() => setCounting(false)} />
      )}
      {variant !== 'notFound' && error !== undefined && <Details error={error} route={route} />}
    </div>
  )
}
