import type { JSX } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import type { Client } from '@shared/tenants'
import { FormDialog } from '../components/dialogs'
import { Field } from '../components/Field'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT } from '../components/styles'
import { useTenantMutation } from '../data/tenants'
import { IpcError } from '../lib/ipc'
import { clientFormSchema, type ClientFormValues } from './forms'

const DEFAULT_COLOR = '#2f6fe4'

/** Alta y edición de un cliente (nombre y color de acento). */
export function ClientForm({
  client,
  onClose
}: {
  /** `null` para crear uno nuevo. */
  client: Client | null
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const create = useTenantMutation('clients:create')
  const update = useTenantMutation('clients:update')
  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: { name: client?.name ?? '', color: client?.color ?? DEFAULT_COLOR }
  })
  const { errors } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (client === null) await create.mutateAsync([values])
      else await update.mutateAsync([{ id: client.id, ...values }])
      onClose()
    } catch (error) {
      if (error instanceof IpcError && error.code === 'CONFLICT') {
        form.setError('name', { message: 'errors.nameTaken' })
      } else {
        form.setError('root', { message: 'errors.generic' })
      }
    }
  })

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={client === null ? t('clientForm.createTitle') : t('clientForm.editTitle')}
      testId="client-form"
    >
      <form onSubmit={(event) => void onSubmit(event)} className="grid gap-4" noValidate>
        <Field label={t('clientForm.name')} error={errors.name?.message}>
          <input data-testid="client-name" className={INPUT} {...form.register('name')} />
        </Field>
        <Field label={t('clientForm.color')} error={errors.color?.message}>
          <input
            data-testid="client-color"
            type="color"
            className="h-8 w-16 cursor-pointer rounded-md border border-border bg-transparent"
            {...form.register('color')}
          />
        </Field>
        {errors.root?.message !== undefined && (
          <p role="alert" className="text-xs text-danger">
            {t(errors.root.message)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="form-cancel"
            onClick={onClose}
            className={BUTTON_SECONDARY}
          >
            {t('form.cancel')}
          </button>
          <button
            type="submit"
            data-testid="form-save"
            disabled={form.formState.isSubmitting}
            className={BUTTON_PRIMARY}
          >
            {t('form.save')}
          </button>
        </div>
      </form>
    </FormDialog>
  )
}
