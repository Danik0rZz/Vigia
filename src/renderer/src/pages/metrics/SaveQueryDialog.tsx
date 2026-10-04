import { useState, type FormEvent, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { FormDialog } from '../../components/dialogs'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT } from '../../components/styles'
import { IpcError } from '../../lib/ipc'

/**
 * Guardar la consulta actual con un nombre. Un nombre repetido (CONFLICT) se
 * dice como tal; cualquier otro fallo, como error genérico. Al cerrar, el
 * nombre y el error se limpian.
 */
export function SaveQueryDialog({
  open,
  onClose,
  onSave,
  saving
}: {
  open: boolean
  onClose: () => void
  /** Rechaza con IpcError si main no la guarda. */
  onSave: (name: string) => Promise<unknown>
  saving: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [error, setError] = useState<'nameTaken' | 'generic' | null>(null)

  const close = (): void => {
    setName('')
    setError(null)
    onClose()
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)
    try {
      await onSave(name.trim())
      close()
    } catch (caught) {
      setError(caught instanceof IpcError && caught.code === 'CONFLICT' ? 'nameTaken' : 'generic')
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={t('metrics.saveTitle')}
      testId="saved-query-form"
    >
      <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('metrics.name')}
          <input
            data-testid="saved-query-name"
            value={name}
            maxLength={80}
            aria-invalid={error !== null || undefined}
            onChange={(event) => setName(event.target.value)}
            className={INPUT}
          />
        </label>
        {error !== null && (
          <p role="alert" className="text-xs text-danger">
            {t(error === 'nameTaken' ? 'errors.nameTaken' : 'errors.generic')}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="form-cancel"
            onClick={close}
            className={BUTTON_SECONDARY}
          >
            {t('form.cancel')}
          </button>
          <button
            type="submit"
            data-testid="form-save"
            disabled={name.trim() === '' || saving}
            className={BUTTON_PRIMARY}
          >
            {t('form.save')}
          </button>
        </div>
      </form>
    </FormDialog>
  )
}
