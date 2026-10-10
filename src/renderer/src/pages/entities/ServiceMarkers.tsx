import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityProblemCounts, ServiceMetricsResult } from '@shared/modules'
import { cn } from '../../lib/cn'
import { formatCount, formatDurationMs, formatErrorRate } from '../../lib/service-format'
import { MarkerCard, MarkerCount, QueryState, RangeLine } from './EntityMarkers'
import { serviceMetricNote, type ServiceMetricNote } from './service-type'

/**
 * Fila de marcadores de la página de un SERVICE (ficha 0008): peticiones OK y
 * KO, tasa de error, tiempos (mediana, p90 y p99) y problemas abiertos y
 * cerrados del rango global. Cada canal se pinta por su lado: si uno falla, sus
 * marcadores enseñan el aviso con Reintentar y los demás siguen. Según el conjunto de métricas
 * (ficha 0047): Solo actividad deja Peticiones y Problemas, y una nota bajo los marcadores dice
 * de dónde salen los datos (mientras carga, los de siempre y sin nota).
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
  const data = metrics.data
  const activityOnly = data?.metricSet === 'activity'
  const note = data === undefined ? null : serviceMetricNote(data)

  return (
    <div className="grid gap-2">
      <div
        data-testid="service-markers"
        role="group"
        aria-label={t('entities.service.markers.label')}
        className={cn('grid gap-4 sm:grid-cols-2', !activityOnly && 'lg:grid-cols-5')}
      >
        {activityOnly ? (
          <MarkerCard
            testId="service-marker-requests"
            title={t('entities.service.markers.requests')}
          >
            <QueryState {...metricState}>
              {(loaded) => <BigValue>{formatCount(requestsOf(loaded), lang)}</BigValue>}
            </QueryState>
          </MarkerCard>
        ) : (
          <>
            <MarkerCard testId="service-marker-ok" title={t('entities.service.markers.ok')}>
              <QueryState {...metricState}>
                {(data) => <BigValue>{formatCount(okOf(data), lang)}</BigValue>}
              </QueryState>
            </MarkerCard>

            <MarkerCard testId="service-marker-ko" title={t('entities.service.markers.ko')}>
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
            </MarkerCard>

            <MarkerCard
              testId="service-marker-error-rate"
              title={t('entities.service.markers.errorRate')}
            >
              <QueryState {...metricState}>
                {(data) => (
                  <BigValue>{formatErrorRate(data?.totals.errorRate ?? null, lang)}</BigValue>
                )}
              </QueryState>
            </MarkerCard>

            <MarkerCard
              testId="service-marker-response-time"
              title={t('entities.service.markers.responseTime')}
            >
              <QueryState {...metricState}>
                {(data) => {
                  const times = data?.totals.responseTime
                  return (
                    <div className="grid gap-1">
                      <p
                        data-testid="service-marker-median"
                        className="flex flex-wrap items-baseline justify-center gap-x-2"
                      >
                        <span className="text-3xl font-semibold tabular-nums">
                          {formatDurationMs(times?.median ?? null, lang)}
                        </span>{' '}
                        <span className="text-xs text-muted-foreground">
                          {t('entities.service.markers.median')}
                        </span>
                      </p>
                      <p className="flex flex-wrap justify-center gap-x-3 text-sm">
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
            </MarkerCard>
          </>
        )}

        <MarkerCard testId="service-marker-problems" title={t('entities.service.markers.problems')}>
          <QueryState query={problems} enabled={problemsEnabled}>
            {(data) => {
              const open = data?.open ?? null
              return (
                <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
                  <MarkerCount
                    testId="service-marker-open"
                    danger={open !== null && open > 0}
                    value={formatCount(open, lang)}
                    label={t('entities.service.markers.open')}
                  />
                  <MarkerCount
                    testId="service-marker-closed"
                    danger={false}
                    value={formatCount(data?.closed ?? null, lang)}
                    label={t('entities.service.markers.closed')}
                  />
                </div>
              )
            }}
          </QueryState>
        </MarkerCard>
      </div>
      {note !== null && <MetricSetNote note={note} />}
      <RangeLine resolution={metrics.data?.resolution ?? null} testId="service-markers-range" />
    </div>
  )
}

/**
 * Nota pequeña bajo los marcadores con el origen de las métricas (ficha 0047) y su explicación
 * en un tooltip que también se abre con el foco.
 */
function MetricSetNote({ note }: { note: ServiceMetricNote }): JSX.Element {
  const { t } = useTranslation()
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <p
          data-testid="service-metric-set-note"
          data-note={note}
          tabIndex={0}
          className="w-fit cursor-help text-xs text-muted-foreground underline decoration-dotted underline-offset-2"
        >
          {t(`entities.service.metricSetNote.${note}`)}
        </p>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="glass z-50 max-w-80 rounded-md px-3 py-2 text-xs text-foreground"
        >
          {t(`entities.service.metricSetNote.${note}Hint`)}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/**
 * Hay dato de peticiones si la serie trae algún punto. Sin ninguno, los totales
 * que manda main son 0 por la suma, pero no es un 0 de Dynatrace: «—».
 */
const hasRequestData = (data: ServiceMetricsResult): boolean =>
  data.series.requests.values.some((value) => value !== null)

const requestsOf = (data: ServiceMetricsResult | null): number | null =>
  data !== null && hasRequestData(data) ? data.totals.requests : null

const okOf = (data: ServiceMetricsResult | null): number | null =>
  data !== null && hasRequestData(data) ? data.totals.ok : null

const errorsOf = (data: ServiceMetricsResult | null): number | null =>
  data !== null && hasRequestData(data) ? data.totals.errors : null

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
