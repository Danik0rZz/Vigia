import { useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { secretKinds, type EnvironmentView, type SecretKind } from '@shared/tenants'
import { ConfirmDialog } from '../components/dialogs'
import { BUTTON_SECONDARY, INPUT } from '../components/styles'
import { useSecretsAvailable, useTenantMutation } from '../data/tenants'

/** En Managed no hay plataforma: solo el token clásico. */
function kindsFor(environment: EnvironmentView): readonly SecretKind[] {
  return environment.deployment === 'managed' ? ['classicToken'] : secretKinds
}

function SecretRow({
  environment,
  kind,
  available,
  onDirtyChange,
  onChanged
}: {
  environment: EnvironmentView
  kind: SecretKind
  available: boolean
  onDirtyChange?: ((kind: SecretKind, dirty: boolean) => void) | undefined
  /** Se ha guardado o borrado: lo que dependía de la credencial anterior ya no vale. */
  onChanged?: (() => void) | undefined
}): JSX.Element {
  const { t } = useTranslation()
  // El valor solo vive aquí hasta guardarlo; después se vacía y nunca vuelve de main.
  const [value, setValue] = useState('')
  const [failed, setFailed] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const save = useTenantMutation('secrets:set')
  const remove = useTenantMutation('secrets:delete')
  const configured = environment.secrets[kind]
  // Guardada pero ilegible (otro equipo o usuario de Windows): hay que volver a introducirla.
  const state = !configured
    ? 'missing'
    : environment.unreadableSecrets.includes(kind)
      ? 'unreadable'
      : 'configured'
  const inputId = `secret-${environment.id}-${kind}`
  const canSave = available && value.trim() !== '' && !save.isPending

  // Quien abre el diálogo necesita saber si queda algo escrito sin guardar.
  const dirty = value.trim() !== ''
  useEffect(() => {
    onDirtyChange?.(kind, dirty)
  }, [onDirtyChange, kind, dirty])

  const onSave = async (): Promise<void> => {
    if (!canSave) return
    setFailed(false)
    try {
      await save.mutateAsync([{ environmentId: environment.id, kind, value }])
      setValue('')
      onChanged?.()
    } catch {
      setFailed(true)
    } finally {
      // La mutación guarda sus variables (el valor del secreto) hasta que se
      // recoge: se limpia ya, guardado o no.
      save.reset()
    }
  }

  // Formulario propio: Enter en el campo guarda este secreto y nada más.
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void onSave()
      }}
      className="grid gap-1.5 rounded-lg border border-border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          {t(`secrets.kinds.${kind}`)}
        </label>
        <span
          data-testid={`secret-status-${kind}`}
          data-state={state}
          className={
            state === 'unreadable' ? 'text-xs text-danger' : 'text-xs text-muted-foreground'
          }
        >
          {state === 'unreadable'
            ? t('secrets.unreadable')
            : state === 'configured'
              ? t('secrets.configured')
              : t('secrets.notConfigured')}
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
          type="submit"
          data-testid={`secret-save-${kind}`}
          disabled={!canSave}
          className={BUTTON_SECONDARY}
        >
          {t('secrets.save')}
        </button>
        <button
          type="button"
          data-testid={`secret-delete-${kind}`}
          disabled={!configured || remove.isPending}
          onClick={() => setConfirmDelete(true)}
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
      {/* Borrar no se puede deshacer: se confirma, como clientes, entornos y consultas. */}
      <ConfirmDialog
        open={confirmDelete}
        title={t('secrets.deleteConfirm', { kind: t(`secrets.kinds.${kind}`) })}
        description={t('secrets.deleteBody')}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          remove.mutate([{ environmentId: environment.id, kind }], {
            onSuccess: () => onChanged?.()
          })
        }}
      />
    </form>
  )
}

/**
 * Credenciales de un entorno ya guardado: estado y alta o baja, nunca el valor.
 * Va FUERA del formulario del entorno: cada secreto tiene el suyo.
 */
export function SecretsPanel({
  environment,
  onDirtyChange,
  onChanged
}: {
  environment: EnvironmentView
  /** Avisa de si queda un secreto escrito sin guardar. */
  onDirtyChange?: (kind: SecretKind, dirty: boolean) => void
  /** Se ha guardado o borrado una credencial (aunque su estado siga igual). */
  onChanged?: () => void
}): JSX.Element {
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
        <SecretRow
          key={kind}
          environment={environment}
          kind={kind}
          available={available}
          onDirtyChange={onDirtyChange}
          onChanged={onChanged}
        />
      ))}
    </section>
  )
}
