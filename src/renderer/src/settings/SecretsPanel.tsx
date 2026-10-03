import { useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { secretKinds, type EnvironmentView, type SecretKind } from '@shared/tenants'
import { BUTTON_SECONDARY, INPUT } from '../components/styles'
import { useSecretsAvailable, useTenantMutation } from '../data/tenants'

/** En Managed no hay plataforma: solo el token clásico. */
function kindsFor(environment: EnvironmentView): readonly SecretKind[] {
  return environment.deployment === 'managed' ? ['classicToken'] : secretKinds
}

function SecretRow({
  environment,
  kind,
  available
}: {
  environment: EnvironmentView
  kind: SecretKind
  available: boolean
}): JSX.Element {
  const { t } = useTranslation()
  // El valor solo vive aquí hasta guardarlo; después se vacía y nunca vuelve de main.
  const [value, setValue] = useState('')
  const [failed, setFailed] = useState(false)
  const save = useTenantMutation('secrets:set')
  const remove = useTenantMutation('secrets:delete')
  const configured = environment.secrets[kind]
  const inputId = `secret-${environment.id}-${kind}`

  const onSave = async (): Promise<void> => {
    setFailed(false)
    try {
      await save.mutateAsync([{ environmentId: environment.id, kind, value }])
      setValue('')
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="grid gap-1.5 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          {t(`secrets.kinds.${kind}`)}
        </label>
        <span data-testid={`secret-status-${kind}`} className="text-xs text-muted-foreground">
          {configured ? t('secrets.configured') : t('secrets.notConfigured')}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          id={inputId}
          data-testid={`secret-input-${kind}`}
          type="password"
          autoComplete="off"
          placeholder={t('secrets.placeholder')}
          value={value}
          disabled={!available}
          onChange={(event) => setValue(event.target.value)}
          className={INPUT}
        />
        <button
          type="button"
          data-testid={`secret-save-${kind}`}
          disabled={!available || value.trim() === '' || save.isPending}
          onClick={() => void onSave()}
          className={BUTTON_SECONDARY}
        >
          {t('secrets.save')}
        </button>
        <button
          type="button"
          data-testid={`secret-delete-${kind}`}
          disabled={!configured || remove.isPending}
          onClick={() => remove.mutate([{ environmentId: environment.id, kind }])}
          className={BUTTON_SECONDARY}
        >
          {t('secrets.delete')}
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-xs text-danger">
          {t('errors.generic')}
        </p>
      )}
    </div>
  )
}

/** Credenciales de un entorno ya guardado: estado y alta o baja, nunca el valor. */
export function SecretsPanel({ environment }: { environment: EnvironmentView }): JSX.Element {
  const { t } = useTranslation()
  const available = useSecretsAvailable()

  return (
    <section className="grid gap-2" aria-labelledby="secrets-title">
      <h3 id="secrets-title" className="font-semibold">
        {t('environmentForm.credentials')}
      </h3>
      <p className="text-xs text-muted-foreground">{t('environmentForm.credentialsHint')}</p>
      {!available && (
        <p data-testid="secrets-unavailable" role="alert" className="text-xs text-danger">
          {t('secrets.unavailable')}
        </p>
      )}
      {kindsFor(environment).map((kind) => (
        <SecretRow key={kind} environment={environment} kind={kind} available={available} />
      ))}
    </section>
  )
}
