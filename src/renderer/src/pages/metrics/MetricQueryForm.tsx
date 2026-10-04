import type { FormEvent, JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Save } from 'lucide-react'
import { estimatePoints, POINTS_WARNING, suggestResolution } from '@shared/metric-points'
import { RefreshButton } from '../../components/ModuleState'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT } from '../../components/styles'

/** Resoluciones del selector; '' = la de por defecto de la API (120 puntos). */
const RESOLUTIONS = ['', '1m', '5m', '10m', '1h', '6h', '1d', 'Inf'] as const

/**
 * Selector de métrica y resolución. Antes de consultar estima los puntos por
 * serie: por encima de POINTS_WARNING avisa y sugiere una resolución, sin
 * impedir la consulta (la API no rebaja la resolución por su cuenta).
 */
export function MetricQueryForm({
  selector,
  onSelectorChange,
  resolution,
  onResolutionChange,
  spanMs,
  onRun,
  onSave,
  onRefresh,
  busy
}: {
  selector: string
  onSelectorChange: (value: string) => void
  resolution: string
  onResolutionChange: (value: string) => void
  /** Duración del rango activo, para estimar los puntos. */
  spanMs: number
  onRun: () => void
  onSave: () => void
  onRefresh: () => void
  busy: boolean
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const points = estimatePoints(spanMs, resolution === '' ? undefined : resolution)
  const suggestion = suggestResolution(spanMs)
  const tooMany = points > POINTS_WARNING

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    onRun()
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid flex-1 gap-1 text-xs text-muted-foreground">
          {t('metrics.selector')}
          <input
            data-testid="metric-selector"
            value={selector}
            maxLength={2000}
            onChange={(event) => onSelectorChange(event.target.value)}
            className={INPUT}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('metrics.resolution')}
          <select
            data-testid="metric-resolution"
            value={resolution}
            onChange={(event) => onResolutionChange(event.target.value)}
            className={`${INPUT} w-36`}
          >
            {RESOLUTIONS.map((value) => (
              <option key={value} value={value}>
                {value === '' ? t('metrics.resolutionAuto') : value}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" data-testid="metric-run" className={BUTTON_PRIMARY}>
          {t('metrics.run')}
        </button>
        <button
          type="button"
          data-testid="saved-query-save"
          disabled={selector.trim() === ''}
          onClick={onSave}
          className={BUTTON_SECONDARY}
        >
          <Save aria-hidden="true" className="size-4" />
          {t('metrics.save')}
        </button>
        <RefreshButton onRefresh={onRefresh} busy={busy} />
      </div>
      {tooMany && (
        <div
          data-testid="points-estimate"
          role="status"
          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        >
          <span>
            {t('metrics.pointsEstimate', {
              points: new Intl.NumberFormat(i18n.language).format(points)
            })}
          </span>
          {suggestion !== resolution && (
            <button
              type="button"
              data-testid="use-resolution"
              onClick={() => onResolutionChange(suggestion)}
              className={BUTTON_SECONDARY}
            >
              {t('metrics.useResolution', { resolution: suggestion })}
            </button>
          )}
        </div>
      )}
    </form>
  )
}
