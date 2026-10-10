import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { UseQueryResult } from '@tanstack/react-query'
import type {
  ApplicationMetricsResult,
  ApplicationRumResult,
  EntityProblemCounts
} from '@shared/modules'
import {
  apdexCategory,
  apdexLevel,
  formatApdex,
  type ApdexLevel
} from '../../lib/application-format'
import { cn } from '../../lib/cn'
import { formatCount, formatDurationMs, formatErrorRate } from '../../lib/service-format'
import { roleHasData } from './application-charts'
import {
  ACTION_TYPES,
  ERROR_TYPES,
  actionTypesWithData,
  errorTypesWithData,
  errorsSeparated,
  hasData,
  sumTotals
} from './application-rum-charts'
import { MarkerCard, MarkerCount, QueryState, RangeLine } from './EntityMarkers'

/** Los marcadores de RUM (ficha 0053), entre el del Apdex y el de problemas. */
type RumMarker = 'users' | 'sessions' | 'actions' | 'errors'
const RUM_MARKERS: readonly RumMarker[] = ['users', 'sessions', 'actions', 'errors']

/**
 * Columnas de la fila según cuántos marcadores salen (1 a 6): con la ventana ancha, todos en
 * una fila; más estrecha, de tres en tres (los seis, en dos filas).
 */
const COLUMNS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-3 xl:grid-cols-4',
  5: 'sm:grid-cols-3 xl:grid-cols-5',
  6: 'sm:grid-cols-3 xl:grid-cols-6'
}

/** ¿Trae datos el marcador de RUM? Sin datos no sale (CA4 de la ficha 0053). */
function rumMarkerHasData(data: ApplicationRumResult, marker: RumMarker): boolean {
  switch (marker) {
    case 'users':
      return hasData(data.series.activeUsers, data.totals.activeUsers)
    case 'sessions':
      return hasData(data.series.sessions.started, data.totals.sessions.started)
    case 'actions':
      return actionTypesWithData(data, 'actionsByType').length > 0
    case 'errors':
      return errorTypesWithData(data).length > 0
  }
}

/**
 * Fila de marcadores de la página de una aplicación web (fichas 0034 y 0053): Apdex (con su
 * categoría), usuarios activos (estimación), sesiones, acciones, errores y problemas del rango
 * global. El Apdex sale de `entities:applicationMetrics` (0033); usuarios, sesiones, acciones y
 * errores, de `entities:applicationRum` (0052), y el de problemas, de `entities:problemCounts`:
 * si un canal falla, sus marcadores enseñan el aviso con Reintentar y los demás siguen. El total
 * de acciones y el de errores son la suma de sus tipos, para que cuadre con lo de debajo. Un
 * marcador sin datos no sale; mientras carga, o si falla, salen todos.
 */
export function ApplicationMarkers({
  metrics,
  rum,
  problems,
  metricsEnabled,
  problemsEnabled
}: {
  metrics: UseQueryResult<ApplicationMetricsResult>
  rum: UseQueryResult<ApplicationRumResult>
  problems: UseQueryResult<EntityProblemCounts>
  /** Sin acceso al módulo no se pide nada y el marcador enseña «—». */
  metricsEnabled: boolean
  problemsEnabled: boolean
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const text = (key: string): string => t(`entities.application.markers.${key}`)
  const series = (key: string): string => t(`entities.application.charts.series.${key}`)
  const metricsData = metricsEnabled && !metrics.isError ? metrics.data : undefined
  const rumData = metricsEnabled && !rum.isError ? rum.data : undefined
  const showApdex = metricsData === undefined || roleHasData(metricsData, 'apdex')
  const rumShown = RUM_MARKERS.filter(
    (marker) => rumData === undefined || rumMarkerHasData(rumData, marker)
  )
  const count = (showApdex ? 1 : 0) + rumShown.length + 1

  const apdexBody = (loaded: ApplicationMetricsResult | null): ReactNode => {
    const value = loaded?.totals.apdex ?? null
    const category = apdexCategory(value)
    const level = apdexLevel(value)
    return (
      <MarkerBody
        value={<BigValue level={level}>{formatApdex(value, lang)}</BigValue>}
        level={category === null ? null : t(`entities.application.apdex.${category}`)}
        levelClass={LEVEL_CLASS[level]}
      />
    )
  }

  const rumBody = (marker: RumMarker, loaded: ApplicationRumResult | null): ReactNode => {
    switch (marker) {
      case 'users':
        return (
          <MarkerBody
            value={<BigValue>{formatCount(loaded?.totals.activeUsers ?? null, lang)}</BigValue>}
            secondary={
              <EstimatedHint label={text('usersEstimated')} hint={text('usersEstimatedHint')} />
            }
          />
        )
      case 'sessions': {
        const duration = loaded?.totals.sessionDuration ?? null
        const bounce = loaded?.totals.bounceRate ?? null
        const parts = [
          // La duración de sesión llega en microsegundos.
          duration === null
            ? null
            : `${text('sessionDuration')} ${formatDurationMs(duration / 1000, lang)}`,
          bounce === null ? null : `${text('bounceRate')} ${formatErrorRate(bounce, lang)}`
        ]
        return (
          <MarkerBody
            value={
              <BigValue>{formatCount(loaded?.totals.sessions.started ?? null, lang)}</BigValue>
            }
            secondary={joinParts(parts)}
          />
        )
      }
      case 'actions': {
        const totals = loaded?.totals.actionsByType
        const types = loaded === null ? [] : actionTypesWithData(loaded, 'actionsByType')
        return (
          <MarkerBody
            value={
              <BigValue>
                {formatCount(
                  totals === undefined ? null : sumTotals(ACTION_TYPES.map((type) => totals[type])),
                  lang
                )}
              </BigValue>
            }
            secondary={joinParts(
              types.map((type) => `${series(type)} ${formatCount(totals?.[type] ?? null, lang)}`)
            )}
          />
        )
      }
      case 'errors': {
        const totals = loaded?.totals.errorsByType
        const total =
          totals === undefined ? null : sumTotals(ERROR_TYPES.map((type) => totals[type]))
        // Sin separar por tipo (todo en «otros»), sin la línea de debajo (CA3 de la ficha).
        const types = loaded === null || !errorsSeparated(loaded) ? [] : errorTypesWithData(loaded)
        return (
          <MarkerBody
            value={
              <BigValue level={total !== null && total > 0 ? 'error' : 'normal'}>
                {formatCount(total, lang)}
              </BigValue>
            }
            secondary={joinParts(
              types.map((type) => `${series(type)} ${formatCount(totals?.[type] ?? null, lang)}`)
            )}
          />
        )
      }
    }
  }

  return (
    <div className="grid gap-2">
      <div
        data-testid="application-markers"
        role="group"
        aria-label={text('label')}
        className={cn('grid grid-cols-2 gap-4', COLUMNS[count])}
      >
        {showApdex && (
          <MarkerCard testId="application-marker-apdex" title={text('apdex')}>
            <QueryState query={metrics} enabled={metricsEnabled}>
              {apdexBody}
            </QueryState>
          </MarkerCard>
        )}

        {rumShown.map((marker) => (
          <MarkerCard key={marker} testId={`application-marker-${marker}`} title={text(marker)}>
            <QueryState query={rum} enabled={metricsEnabled}>
              {(loaded) => rumBody(marker, loaded)}
            </QueryState>
          </MarkerCard>
        ))}

        <MarkerCard testId="application-marker-problems" title={text('problems')}>
          <QueryState query={problems} enabled={problemsEnabled}>
            {(counts) => {
              const open = counts?.open ?? null
              return (
                <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
                  <MarkerCount
                    testId="application-marker-open"
                    danger={open !== null && open > 0}
                    value={formatCount(open, lang)}
                    label={t('entities.service.markers.open')}
                  />
                  <MarkerCount
                    testId="application-marker-closed"
                    danger={false}
                    value={formatCount(counts?.closed ?? null, lang)}
                    label={t('entities.service.markers.closed')}
                  />
                </div>
              )
            }}
          </QueryState>
        </MarkerCard>
      </div>
      <RangeLine resolution={metrics.data?.resolution ?? null} testId="application-markers-range" />
    </div>
  )
}

/** Las partes de la línea de debajo, con « · »; sin ninguna, null (no hay línea). */
function joinParts(parts: readonly (string | null)[]): string | null {
  const known = parts.filter((part): part is string => part !== null)
  return known.length === 0 ? null : known.join(' · ')
}

/** Color del valor según su nivel; el del Apdex lleva además su texto (el color nunca va solo). */
const LEVEL_CLASS: Record<ApdexLevel, string> = {
  normal: '',
  success: 'text-status-closed',
  warning: 'text-status-warning',
  error: 'text-danger'
}

/** Valor principal, la línea de debajo (si la hay) y el texto del nivel (si lo hay). */
function MarkerBody({
  value,
  secondary = null,
  level = null,
  levelClass = ''
}: {
  value: ReactNode
  secondary?: ReactNode
  level?: string | null
  levelClass?: string
}): JSX.Element {
  return (
    <div className="grid justify-items-center gap-1">
      {value}
      {secondary !== null && (
        <p data-testid="application-marker-secondary" className="text-xs text-muted-foreground">
          {secondary}
        </p>
      )}
      {level !== null && (
        <p
          data-testid="application-marker-level"
          className={cn('text-xs font-semibold', levelClass)}
        >
          {level}
        </p>
      )}
    </div>
  )
}

/** «estimado», con la explicación en un tooltip que también se abre con el foco. */
function EstimatedHint({ label, hint }: { label: string; hint: string }): JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          data-testid="application-marker-users-hint"
          tabIndex={0}
          className="cursor-help underline decoration-dotted underline-offset-2"
        >
          {label}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="glass z-50 max-w-80 rounded-md px-3 py-2 text-xs font-normal text-foreground"
        >
          {hint}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/** Valor principal del marcador, con el color de su nivel. */
function BigValue({
  level = 'normal',
  children
}: {
  level?: ApdexLevel
  children: string
}): JSX.Element {
  return (
    <p
      data-testid="application-marker-value"
      data-level={level}
      className={cn('text-3xl font-semibold tabular-nums wrap-anywhere', LEVEL_CLASS[level])}
    >
      {children}
    </p>
  )
}
