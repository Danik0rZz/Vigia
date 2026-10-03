import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { unavailableReason, type ModuleAccess } from '../data/modules'
import { IpcError } from '../lib/ipc'
import { BUTTON_SECONDARY } from './styles'

/** Módulo desactivado, con la explicación (no es un error). */
export function ModuleUnavailable({
  access
}: {
  access: Exclude<ModuleAccess, { available: true }>
}): JSX.Element {
  const { t } = useTranslation()
  const reason = unavailableReason(access)
  const text = t(reason.key, reason.params)
  return (
    <p
      data-testid="module-unavailable"
      className="glass rounded-xl p-5 text-sm text-muted-foreground"
    >
      {text}
    </p>
  )
}

/** Error de una consulta: el código traducido como texto principal y el detalle de Dynatrace aparte. */
export function ModuleError({ error }: { error: unknown }): JSX.Element {
  const { t } = useTranslation()
  const code = error instanceof IpcError ? error.code : null
  const translated = code !== null && t(`dtErrors.${code}`, { defaultValue: '' })
  return (
    <div role="alert" className="grid gap-1 rounded-lg border border-danger/50 p-3 text-sm">
      <p className="text-danger">
        {translated !== '' && translated !== false ? translated : t('errors.generic')}
      </p>
      {error instanceof IpcError && (
        <p className="text-xs text-muted-foreground">{error.message}</p>
      )}
    </div>
  )
}

/** Botón "Actualizar": la única forma de volver a pedir datos (no hay auto-refresco). */
export function RefreshButton({
  onRefresh,
  busy
}: {
  onRefresh: () => void
  busy: boolean
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      data-testid="module-refresh"
      onClick={onRefresh}
      disabled={busy}
      className={BUTTON_SECONDARY}
    >
      <RefreshCw aria-hidden="true" className={busy ? 'size-4 animate-spin' : 'size-4'} />
      {t('module.refresh')}
    </button>
  )
}

/**
 * Aviso de lista truncada: hay más datos de los que se muestran. Con el total
 * de la API, "Mostrando N de M"; sin él, "Mostrando los primeros N".
 */
export function TruncatedNotice({
  shown,
  total
}: {
  shown: number
  total: number | null
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const format = (value: number): string => new Intl.NumberFormat(i18n.language).format(value)
  return (
    <p data-testid="list-truncated" className="text-xs text-muted-foreground">
      {total !== null && total > shown
        ? t('module.truncatedOf', { shown: format(shown), total: format(total) })
        : t('module.truncated', { count: shown })}
    </p>
  )
}
