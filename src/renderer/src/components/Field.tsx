import { cloneElement, useId, type JSX, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Etiqueta, control y error de un campo. El error (una clave i18n) se anuncia
 * con role="alert" y marca el control con aria-invalid.
 */
export function Field({
  label,
  error,
  children
}: {
  label: string
  error?: string | undefined
  children: ReactElement<Record<string, unknown>>
}): JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  const errorId = `${id}-error`
  const control = cloneElement(children, {
    id,
    'aria-invalid': error !== undefined ? true : undefined,
    // Se suma a la descripción que ya traiga el control (por ejemplo, un aviso).
    'aria-describedby':
      [error !== undefined ? errorId : null, children.props['aria-describedby']]
        .filter((id) => typeof id === 'string' && id !== '')
        .join(' ') || undefined
  })

  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {control}
      {error !== undefined && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {t(error)}
        </p>
      )}
    </div>
  )
}
