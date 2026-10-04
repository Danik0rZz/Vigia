import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TokenInfo, UntrustedCertificate } from '@shared/dynatrace'
import type { EnvironmentView } from '@shared/tenants'
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from '../components/styles'
import { queryKeys, useTenantMutation } from '../data/tenants'
import { invoke } from '../lib/ipc'
import { cn } from '../lib/cn'

function CertificateBlock({
  environmentId,
  certificate,
  onAccepted
}: {
  environmentId: string
  certificate: UntrustedCertificate
  onAccepted: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const pin = useTenantMutation('certificates:pin')
  const mismatch = certificate.reason === 'mismatch'

  return (
    <div
      data-testid="certificate-untrusted"
      role="alert"
      className="grid gap-2 rounded-lg border border-danger/50 p-3 text-xs"
    >
      <p className="font-medium text-danger">
        {t(mismatch ? 'certificates.mismatch' : 'certificates.untrusted', {
          host: certificate.host
        })}
      </p>
      {certificate.previousFingerprint !== null && (
        <p>
          <span className="text-muted-foreground">{t('certificates.previous')}: </span>
          <code data-testid="certificate-previous-fingerprint" className="break-all">
            {certificate.previousFingerprint}
          </code>
        </p>
      )}
      <p>
        <span className="text-muted-foreground">{t('certificates.current')}: </span>
        <code data-testid="certificate-new-fingerprint" className="break-all">
          {certificate.fingerprint}
        </code>
      </p>
      <div>
        <button
          type="button"
          data-testid="certificate-accept"
          disabled={pin.isPending}
          onClick={() =>
            pin.mutate(
              [{ environmentId, host: certificate.host, fingerprint: certificate.fingerprint }],
              { onSuccess: onAccepted }
            )
          }
          className={BUTTON_SECONDARY}
        >
          {t('certificates.accept')}
        </button>
      </div>
      {pin.isError && (
        <p data-testid="certificate-accept-error" className="text-danger">
          {t('certificates.notObserved')}
        </p>
      )}
    </div>
  )
}

/** Lista de scopes con su título; vacía muestra "Ninguno". */
function ScopeList({
  testId,
  title,
  scopes
}: {
  testId: string
  title: string
  scopes: string[]
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div data-testid={testId} className="grid gap-0.5">
      <span className="text-muted-foreground">{title}</span>
      <span className="break-all">
        {scopes.length === 0 ? t('connection.token.none') : scopes.join(', ')}
      </span>
    </div>
  )
}

/** Lo que se sabe del token probado: nombre, caducidad y scopes (nunca el token ni su id). */
function TokenInfoBlock({ id, info }: { id: string; info: TokenInfo }): JSX.Element {
  const { t, i18n } = useTranslation()
  const expires =
    info.expiresAt === null
      ? t('connection.token.noExpiry')
      : t('connection.token.expires', {
          date: new Intl.DateTimeFormat(i18n.language, {
            dateStyle: 'short',
            timeStyle: 'short'
          }).format(new Date(info.expiresAt))
        })
  return (
    <div data-testid={`token-info-${id}`} className="mt-1 grid gap-1 border-t border-border pt-1">
      <span>
        {info.name ?? t('connection.token.title')}
        {' · '}
        {expires}
      </span>
      {info.enabled === false && (
        <span data-testid="token-disabled" role="alert" className="text-danger">
          {t('connection.token.disabled')}
        </span>
      )}
      <ScopeList
        testId="token-scopes-granted"
        title={t('connection.token.granted')}
        scopes={info.scopes.granted}
      />
      <ScopeList
        testId="token-scopes-missing"
        title={t('connection.token.missing')}
        scopes={info.scopes.missing}
      />
      <ScopeList
        testId="token-scopes-extra"
        title={t('connection.token.extra')}
        scopes={info.scopes.extra}
      />
    </div>
  )
}

/**
 * "Probar conexión" de un entorno guardado: resultado por mecanismo, scopes que
 * faltan y certificados por aceptar. La huella solo cambia si el usuario la acepta.
 */
export function ConnectionPanel({ environment }: { environment: EnvironmentView }): JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const test = useMutation({
    mutationFn: () => invoke('connection:test', { environmentId: environment.id }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectionStatus(environment.id) })
      // Una credencial ilegible queda marcada en main: el estado de los secretos cambia.
      void queryClient.invalidateQueries({ queryKey: queryKeys.tenants })
    }
  })
  const hasCredentials = Object.values(environment.secrets).some(Boolean)
  const report = test.data
  const certificates = report?.untrustedCertificates ?? []

  return (
    <section className="grid gap-2" aria-labelledby="connection-title">
      <div className="flex items-center gap-2">
        <h3 id="connection-title" className="flex-1 font-semibold">
          {t('connection.title')}
        </h3>
        <button
          type="button"
          data-testid="connection-test"
          disabled={!hasCredentials || test.isPending}
          onClick={() => test.mutate()}
          className={BUTTON_PRIMARY}
        >
          {test.isPending ? t('connection.testing') : t('connection.test')}
        </button>
      </div>
      {!hasCredentials && (
        <p className="text-xs text-muted-foreground">{t('connection.noCredentials')}</p>
      )}
      {test.isError && (
        <p role="alert" className="text-xs text-danger">
          {t('errors.generic')}
        </p>
      )}
      {report !== undefined && (
        <ul className="grid gap-1">
          {report.mechanisms.map((mechanism) => (
            <li
              key={mechanism.id}
              data-testid={`connection-result-${mechanism.id}`}
              className="grid gap-0.5 rounded-md border border-border px-3 py-2 text-xs"
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-2 rounded-full',
                    mechanism.state === 'connected' ? 'bg-accent' : 'bg-danger'
                  )}
                />
                <span className="font-medium">{t(`envStatus.mechanisms.${mechanism.id}`)}</span>
                <span>
                  {mechanism.state === 'connected'
                    ? t('connection.connected')
                    : t('connection.disconnected')}
                </span>
              </span>
              {mechanism.error !== null && (
                <span className="text-danger">
                  {t(`dtErrors.${mechanism.error.code}`)} {mechanism.error.message}
                </span>
              )}
              {mechanism.missingScopes.length > 0 && (
                <span className="text-muted-foreground">
                  {t('connection.missingScopes', { scopes: mechanism.missingScopes.join(', ') })}
                </span>
              )}
              {mechanism.tokenInfo !== null && (
                <TokenInfoBlock id={mechanism.id} info={mechanism.tokenInfo} />
              )}
            </li>
          ))}
        </ul>
      )}
      {certificates.map((certificate) => (
        <CertificateBlock
          key={certificate.host}
          environmentId={environment.id}
          certificate={certificate}
          // Tras aceptar una huella el resultado anterior ya no vale: se vuelve a probar.
          onAccepted={() => test.reset()}
        />
      ))}
    </section>
  )
}
