import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityProblemCounts, ServiceMetricsResult } from '@shared/modules'
import { formatDateTime } from '@shared/format-date'
import { useTimeRangeValue } from '../../app/time-range'
import { BUTTON_SECONDARY } from '../../components/styles'
import { cn } from '../../lib/cn'
import { dateLang } from '../../lib/date-lang'
import { errorDetail } from '../../lib/error-detail'
import { IpcError } from '../../lib/ipc'
import {
  formatCount,
  formatDurationMs,
  formatErrorRate,
  parseResolution
} from '../../lib/service-format'

/**
 * Fila de marcadores de la página de un SERVICE (ficha 0008): peticiones OK y
 * KO, tasa de error, tiempos (mediana, p90 y p99) y problemas abiertos y
 * cerrados del rango global. Cada canal se pinta por su lado: si uno falla, sus
 * marcadores enseñan el aviso con Reintentar y los demás siguen.
 */
export function ServiceMarkers({
  metrics,
  problems,
  metricsEnabled,
  problemsEnabled
}: {
  metrics: UseQueryResult<ServiceMetricsResult>
  problems: UseQueryResult<EntityProblemCounts>
  /** Sin acceso al módulo no se pide nada y el marcador enseña «—». */
  metricsEnabled: boolean
  problemsEnabled: boolean
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const metricState = { query: metrics, enabled: metricsEnabled }

  return (
    <div className="grid gap-2">
      <div
        data-testid="service-markers"
        role="group"
        aria-label={t('entities.service.markers.label')}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <Marker testId="service-marker-ok" title={t('entities.service.markers.ok')}>
          <QueryState {...metricState}>
            {(data) => <BigValue>{formatCount(okOf(data), lang)}</BigValue>}
          </QueryState>
        </Marker>

        <Marker testId="service-marker-ko" title={t('entities.service.markers.ko')}>
          <QueryState {...metricState}>
            {(data) => {
              const errors = errorsOf(data)
              return (
                <BigValue danger={errors !== null && errors > 0}>
                  {formatCount(errors, lang)}
                </BigValue>
              )
            }}
          </QueryState>
        </Marker>

        <Marker testId="service-marker-error-rate" title={t('entities.service.markers.errorRate')}>
          <QueryState {...metricState}>
            {(data) => <BigValue>{formatErrorRate(data?.totals.errorRate ?? null, lang)}</BigValue>}
          </QueryState>
        </Marker>

        <Marker
          testId="service-marker-response-time"
          title={t('entities.service.markers.responseTime')}
        >
          <QueryState {...metricState}>
            {(data) => {
              const times = data?.totals.responseTime
              return (
                <div className="grid gap-1">
                  <p data-testid="service-marker-median" className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold tabular-nums">
                      {formatDurationMs(times?.median ?? null, lang)}
                    </span>{' '}
                    <span className="text-xs text-muted-foreground">
                      {t('entities.service.markers.median')}
                    </span>
                  </p>
                  <p className="flex flex-wrap gap-x-3 text-sm">
                    <Percentile
                      testId="service-marker-p90"
                      label={t('entities.service.markers.p90')}
                      hint={t('entities.service.markers.p90Hint')}
                      value={formatDurationMs(times?.p90 ?? null, lang)}
                    />
                    <Percentile
                      testId="service-marker-p99"
                      label={t('entities.service.markers.p99')}
                      hint={t('entities.service.markers.p99Hint')}
                      value={formatDurationMs(times?.p99 ?? null, lang)}
                    />
                  </p>
                </div>
              )
            }}
          </QueryState>
        </Marker>

        <Marker testId="service-marker-problems" title={t('entities.service.markers.problems')}>
          <QueryState query={problems} enabled={problemsEnabled}>
            {(data) => {
              const open = data?.open ?? null
              return (
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  <Count
                    testId="service-marker-open"
                    danger={open !== null && open > 0}
                    value={formatCount(open, lang)}
                    label={t('entities.service.markers.open')}
                  />
                  <Count
                    testId="service-marker-closed"
                    danger={false}
                    value={formatCount(data?.closed ?? null, lang)}
                    label={t('entities.service.markers.closed')}
                  />
                </div>
              )
            }}
          </QueryState>
        </Marker>
      </div>
      <RangeLine resolution={metrics.data?.resolution ?? null} />
    </div>
  )
}

/**
 * Hay dato de peticiones si la serie trae algún punto. Sin ninguno, los totales
 * que manda main son 0 por la suma, pero no es un 0 de Dynatrace: «—».
 */
const hasRequestData = (data: ServiceMetricsResult): boolean =>
  data.series.requests.values.some((value) => value !== null)

const okOf = (data: ServiceMetricsResult | null): number | null =>
  data !== null && hasRequestData(data) ? data.totals.ok : null

const errorsOf = (data: ServiceMetricsResult | null): number | null =>
  data !== null && hasRequestData(data) ? data.totals.errors : null

/** Tarjeta de un marcador, con el estilo de las de Inicio. No es interactiva. */
function Marker({
  testId,
  title,
  children
}: {
  testId: string
  title: string
  children: ReactNode
}): JSX.Element {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="glass grid min-w-0 content-start gap-2 rounded-xl p-4"
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

/** Valor principal del marcador; en rojo si hay que llamar la atención (el número es el texto). */
function BigValue({
  danger = false,
  children
}: {
  danger?: boolean
  children: string
}): JSX.Element {
  return (
    <p
      data-testid="service-marker-value"
      className={cn('text-3xl font-semibold tabular-nums wrap-anywhere', danger && 'text-danger')}
    >
      {children}
    </p>
  )
}

/** Un recuento con su nombre debajo (abiertos o cerrados). */
function Count({
  testId,
  danger,
  value,
  label
}: {
  testId: string
  danger: boolean
  value: string
  label: string
}): JSX.Element {
  return (
    <p data-testid={testId} className={cn('grid', danger && 'text-danger')}>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>{' '}
      <span className={cn('text-xs', !danger && 'text-muted-foreground')}>{label}</span>
    </p>
  )
}

/** p90 o p99 con su explicación en un tooltip que también se abre con el foco. */
function Percentile({
  testId,
  label,
  hint,
  value
}: {
  testId: string
  label: string
  hint: string
  value: string
}): JSX.Element {
  return (
    <span data-testid={testId} className="flex items-baseline gap-1">
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span
            tabIndex={0}
            className="cursor-help text-muted-foreground underline decoration-dotted underline-offset-2"
          >
            {label}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={6}
            className="glass z-50 max-w-80 rounded-md px-3 py-2 text-xs text-foreground"
          >
            {hint}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>{' '}
      <span className="font-medium tabular-nums">{value}</span>
    </span>
  )
}

/**
 * Estado de un canal dentro de un marcador: esqueleto mientras carga, aviso con
 * Reintentar si falla y, si no, el valor. Sin acceso al módulo, el valor sin dato.
 */
function QueryState<T>({
  query,
  enabled,
  children
}: {
  query: UseQueryResult<T>
  enabled: boolean
  children: (data: T | null) => ReactNode
}): ReactNode {
  if (!enabled) return children(null)
  if (query.isError) {
    return (
      <MarkerError
        error={query.error}
        busy={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    )
  }
  if (query.data === undefined) return <MarkerSkeleton />
  return children(query.data)
}

function MarkerSkeleton(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div role="status" aria-label={t('entities.service.markers.loading')} className="grid gap-2">
      <span className="h-9 w-24 rounded-md bg-hover motion-safe:animate-pulse" />
      <span className="h-3 w-16 rounded bg-hover motion-safe:animate-pulse" />
    </div>
  )
}

/**
 * Aviso compacto de un canal que ha fallado, con Reintentar (solo ese canal): el
 * código traducido y, debajo y en pequeño, el detalle (motivo o texto de Dynatrace).
 */
export function MarkerError({
  error,
  busy,
  onRetry
}: {
  error: unknown
  busy: boolean
  onRetry: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const code = error instanceof IpcError ? error.code : null
  const translated = code !== null ? t(`dtErrors.${code}`, { defaultValue: '' }) : ''
  return (
    <div role="alert" className="grid min-w-0 justify-items-start gap-2 text-sm">
      <p className="text-danger">
        {translated !== '' ? translated : t('entities.service.markers.loadError')}
      </p>
      {/* El motivo traducido o el texto de Dynatrace (ADR-0005), como en ModuleError. */}
      {error instanceof IpcError && (
        <p className="text-xs wrap-anywhere text-muted-foreground">{errorDetail(t, error)}</p>
      )}
      <button type="button" onClick={onRetry} disabled={busy} className={BUTTON_SECONDARY}>
        {t('errorScreen.retry')}
      </button>
    </div>
  )
}

/** «Últimas 2 h · datos por minuto»: el rango global y la resolución que devolvió la API. */
function RangeLine({ resolution }: { resolution: string | null }): JSX.Element {
  const { t, i18n } = useTranslation()
  const range = useTimeRangeValue()
  const lang = dateLang(i18n.language)
  const rangeText =
    typeof range === 'string'
      ? t(`entities.service.range.${range}`)
      : t('entities.service.range.custom', {
          from: formatDateTime(Date.parse(range.from), lang),
          to: formatDateTime(Date.parse(range.to), lang)
        })
  const parts = [rangeText]
  if (resolution !== null) {
    const parsed = parseResolution(resolution)
    parts.push(
      parsed === null
        ? t('entities.service.resolution.raw', { value: resolution })
        : parsed.amount === 1
          ? t(`entities.service.resolution.per.${parsed.unit}`)
          : t(`entities.service.resolution.every.${parsed.unit}`, { amount: parsed.amount })
    )
  }
  return (
    <p data-testid="service-markers-range" className="text-xs text-muted-foreground">
      {parts.join(' · ')}
    </p>
  )
}
