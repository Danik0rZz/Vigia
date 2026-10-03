import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'
import type { EnvStatus } from './env-status'

function StatusDot({ className }: { className: string }): JSX.Element {
  return <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', className)} />
}

/**
 * Tarjeta de estado del entorno activo: conexión por mecanismo y caducidad del
 * token OAuth. Sin entorno, muestra un estado neutro en lugar de datos inventados.
 */
export function EnvStatusCard({
  status,
  collapsed
}: {
  status: EnvStatus | null
  collapsed: boolean
}): JSX.Element {
  const { t, i18n } = useTranslation()

  return (
    <section
      data-testid="env-status"
      aria-label={t('envStatus.label')}
      title={collapsed && status === null ? t('envStatus.none') : undefined}
      className={cn(
        'rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground',
        collapsed && 'flex justify-center px-0'
      )}
    >
      {status === null ? (
        <p className="flex items-center gap-2">
          <StatusDot className="bg-status-neutral" />
          <span className={cn(collapsed && 'sr-only')}>{t('envStatus.none')}</span>
        </p>
      ) : (
        <div className={cn('grid gap-1', collapsed && 'sr-only')}>
          <ul className="grid gap-1">
            {status.mechanisms.map((mechanism) => (
              <li key={mechanism.id} className="flex items-center gap-2">
                <StatusDot className={mechanism.connected ? 'bg-accent' : 'bg-status-neutral'} />
                <span className="text-foreground">{t(`envStatus.mechanisms.${mechanism.id}`)}</span>
                <span>
                  {mechanism.connected ? t('envStatus.connected') : t('envStatus.disconnected')}
                </span>
              </li>
            ))}
          </ul>
          {status.oauthExpiresAt !== null && (
            <p>
              {t('envStatus.oauthExpires', {
                // Con fecha: un token que caduca mañana no puede parecer que caduca hoy.
                time: new Intl.DateTimeFormat(i18n.language, {
                  dateStyle: 'short',
                  timeStyle: 'short'
                }).format(status.oauthExpiresAt)
              })}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
