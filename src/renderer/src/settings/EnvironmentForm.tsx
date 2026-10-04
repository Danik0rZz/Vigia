import { useCallback, useEffect, useId, useState, type FocusEvent, type JSX } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { certificateLevels, deployments, environmentTypes, type SecretKind } from '@shared/tenants'
import { ConfirmDialog, FormDialog } from '../components/dialogs'
import { Field } from '../components/Field'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT } from '../components/styles'
import { useTenantMutation, useTenants } from '../data/tenants'
import { IpcError } from '../lib/ipc'
import {
  environmentFormSchema,
  environmentToForm,
  formToEnvironmentInput,
  NEW_ENVIRONMENT,
  normalizedClassicUrl,
  type EnvironmentFormValues
} from './forms'
import { ConnectionPanel } from './ConnectionPanel'
import { SecretsPanel } from './SecretsPanel'

/** Alta y edición de un entorno. Las credenciales se gestionan una vez guardado. */
export function EnvironmentForm({
  clientId,
  environmentId,
  onClose
}: {
  clientId: string
  /** `null` para crear uno nuevo. */
  environmentId: string | null
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const { environments } = useTenants()
  const environment = environments.find((env) => env.id === environmentId) ?? null
  const create = useTenantMutation('environments:create')
  const update = useTenantMutation('environments:update')

  const form = useForm<EnvironmentFormValues>({
    resolver: zodResolver(environmentFormSchema),
    defaultValues: environment === null ? NEW_ENVIRONMENT : environmentToForm(environment)
  })
  const { errors } = form.formState
  const saas = useWatch({ control: form.control, name: 'deployment' }) === 'saas'
  const ignoring = useWatch({ control: form.control, name: 'certificateLevel' }) === 'ignore'
  const ignoreWarningId = useId()

  // Aceptar una huella cambia el nivel en main: el formulario lo refleja, para
  // que guardar no lo devuelva al valor anterior.
  const storedLevel = environment?.certificateLevel
  useEffect(() => {
    if (storedLevel !== undefined) form.setValue('certificateLevel', storedLevel)
  }, [storedLevel, form])

  // Secretos escritos y sin guardar: cerrar los perdería, así que se pregunta.
  const formId = useId()
  const [dirtySecrets, setDirtySecrets] = useState<ReadonlySet<SecretKind>>(new Set())
  const [confirmClose, setConfirmClose] = useState(false)
  // Sube con cada credencial guardada o borrada: reinicia "Probar conexión".
  const [credentialsVersion, setCredentialsVersion] = useState(0)
  const onSecretDirty = useCallback((kind: SecretKind, dirty: boolean) => {
    setDirtySecrets((current) => {
      if (current.has(kind) === dirty) return current
      const next = new Set(current)
      if (dirty) next.add(kind)
      else next.delete(kind)
      return next
    })
  }, [])
  const requestClose = (): void => {
    if (dirtySecrets.size > 0) setConfirmClose(true)
    else onClose()
  }

  // Al pasar de SaaS a Managed, los secretos de plataforma quedarían huérfanos
  // (Managed no tiene plataforma). Main los borra en la misma transacción que
  // el cambio, pero solo con dropPlatformSecrets, que se manda tras confirmarlo.
  const [pendingManaged, setPendingManaged] = useState<{
    values: EnvironmentFormValues
    kinds: SecretKind[]
  } | null>(null)

  const save = async (
    values: EnvironmentFormValues,
    dropPlatformSecrets = false
  ): Promise<void> => {
    const input = formToEnvironmentInput(values, clientId)
    try {
      if (environment === null) await create.mutateAsync([input])
      else {
        await update.mutateAsync([
          { id: environment.id, ...input, ...(dropPlatformSecrets ? { dropPlatformSecrets } : {}) }
        ])
      }
      requestClose()
    } catch (error) {
      // CONFLICT por secretos de plataforma (la vista estaba desfasada): no es el nombre.
      const platform = error instanceof IpcError && error.reason?.key === 'platformSecretsPresent'
      if (error instanceof IpcError && error.code === 'CONFLICT' && !platform) {
        form.setError('name', { message: 'errors.nameTaken' })
      } else {
        form.setError('root', { message: 'errors.generic' })
      }
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const platformKinds: SecretKind[] =
      environment !== null && environment.deployment === 'saas' && values.deployment === 'managed'
        ? (['oauthClientSecret', 'platformToken'] as const).filter(
            (kind) => environment.secrets[kind]
          )
        : []
    if (platformKinds.length > 0) {
      // Nada se guarda hasta que se confirma.
      setPendingManaged({ values, kinds: platformKinds })
      return
    }
    await save(values)
  })

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && requestClose()}
      title={
        environment === null ? t('environmentForm.createTitle') : t('environmentForm.editTitle')
      }
      testId="environment-form"
      wide
    >
      <div className="grid gap-4">
        <form
          id={formId}
          onSubmit={(event) => void onSubmit(event)}
          className="grid gap-4"
          noValidate
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('environmentForm.name')} error={errors.name?.message}>
              <input data-testid="environment-name" className={INPUT} {...form.register('name')} />
            </Field>
            <Field label={t('environmentForm.type')}>
              <select data-testid="environment-type" className={INPUT} {...form.register('type')}>
                {environmentTypes.map((type) => (
                  <option key={type} value={type}>
                    {t(`environmentTypes.${type}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('environmentForm.deployment')}>
              <select
                data-testid="environment-deployment"
                className={INPUT}
                {...form.register('deployment')}
              >
                {deployments.map((deployment) => (
                  <option key={deployment} value={deployment}>
                    {t(`deployments.${deployment}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('environmentForm.certificateLevel')}>
              <select
                data-testid="environment-certificate-level"
                className={INPUT}
                aria-describedby={ignoring ? ignoreWarningId : undefined}
                {...form.register('certificateLevel')}
              >
                {certificateLevels.map((level) => (
                  <option key={level} value={level}>
                    {t(`certificateLevels.${level}`)}
                  </option>
                ))}
              </select>
            </Field>
            {ignoring && (
              <p
                id={ignoreWarningId}
                data-testid="certificate-ignore-warning"
                role="alert"
                className="text-xs text-danger sm:col-span-2"
              >
                {t('certificates.ignoreRisk')}
              </p>
            )}
            <Field label={t('environmentForm.classicApiUrl')} error={errors.classicApiUrl?.message}>
              <input
                data-testid="environment-classic-url"
                className={INPUT}
                {...form.register('classicApiUrl', {
                  // Al salir del campo se ve la URL tal como se guardará (sin /api/v2).
                  onBlur: (event: FocusEvent<HTMLInputElement>) => {
                    const normalized = normalizedClassicUrl(event.target.value)
                    if (normalized !== event.target.value)
                      form.setValue('classicApiUrl', normalized)
                  }
                })}
              />
            </Field>
            <Field label={t('environmentForm.ssoUrl')} error={errors.ssoUrl?.message}>
              <input
                data-testid="environment-sso-url"
                className={INPUT}
                {...form.register('ssoUrl')}
              />
            </Field>
            {saas && (
              <>
                <Field label={t('environmentForm.platformUrl')} error={errors.platformUrl?.message}>
                  <input
                    data-testid="environment-platform-url"
                    className={INPUT}
                    {...form.register('platformUrl')}
                  />
                </Field>
                <Field label={t('environmentForm.oauthClientId')}>
                  <input
                    data-testid="environment-oauth-client-id"
                    className={INPUT}
                    {...form.register('oauthClientId')}
                  />
                </Field>
                <Field label={t('environmentForm.oauthScopes')}>
                  <input
                    data-testid="environment-oauth-scopes"
                    className={INPUT}
                    {...form.register('oauthScopes')}
                  />
                </Field>
                <Field label={t('environmentForm.accountUuid')}>
                  <input
                    data-testid="environment-account-uuid"
                    className={INPUT}
                    {...form.register('accountUuid')}
                  />
                </Field>
              </>
            )}
            <Field label={t('environmentForm.tags')}>
              <input data-testid="environment-tags" className={INPUT} {...form.register('tags')} />
            </Field>
            <Field label={t('environmentForm.capturePatterns')}>
              <textarea
                data-testid="environment-capture-patterns"
                rows={2}
                className={`${INPUT} h-auto py-1.5`}
                {...form.register('captureUrlPatterns')}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="environment-read-only"
              className="size-4 accent-[var(--accent)]"
              {...form.register('readOnly')}
            />
            {t('environmentForm.readOnly')}
          </label>

          {errors.root?.message !== undefined && (
            <p role="alert" className="text-xs text-danger">
              {t(errors.root.message)}
            </p>
          )}
        </form>

        {/* Hermanos del formulario, no hijos: Enter en un secreto no guarda el entorno. */}
        {environment === null ? (
          <p className="text-xs text-muted-foreground">{t('environmentForm.saveFirst')}</p>
        ) : (
          <>
            <SecretsPanel
              environment={environment}
              onDirtyChange={onSecretDirty}
              onChanged={() => setCredentialsVersion((version) => version + 1)}
            />
            {/* Al guardar o borrar una credencial, el resultado anterior ya no vale
                (aunque el estado siga en "Configurado": el token puede ser otro).
                Se monta de nuevo y el último "Probar conexión" se olvida. */}
            <ConnectionPanel key={credentialsVersion} environment={environment} />
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="form-cancel"
            onClick={requestClose}
            className={BUTTON_SECONDARY}
          >
            {t('form.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            data-testid="form-save"
            disabled={form.formState.isSubmitting}
            className={BUTTON_PRIMARY}
          >
            {t('form.save')}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={pendingManaged !== null}
        title={t('environmentForm.toManagedTitle')}
        description={t('environmentForm.toManagedBody', {
          kinds: (pendingManaged?.kinds ?? []).map((kind) => t(`secrets.kinds.${kind}`)).join(', ')
        })}
        onCancel={() => setPendingManaged(null)}
        onConfirm={() => {
          const pending = pendingManaged
          setPendingManaged(null)
          if (pending !== null) void save(pending.values, true)
        }}
      />
      <ConfirmDialog
        open={confirmClose}
        title={t('secrets.unsavedTitle')}
        description={t('secrets.unsavedBody')}
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false)
          onClose()
        }}
      />
    </FormDialog>
  )
}
