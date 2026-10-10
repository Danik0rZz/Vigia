import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import { formatDateTime } from '@shared/format-date'
import { useTimeRangeValue } from '../../app/time-range'
import { BUTTON_SECONDARY } from '../../components/styles'
import { cn } from '../../lib/cn'
import { dateLang } from '../../lib/date-lang'
import { errorDetail } from '../../lib/error-detail'
import { IpcError } from '../../lib/ipc'
import { parseResolution } from '../../lib/service-format'

/*
 * Piezas comunes de los marcadores de las páginas de entidad (sacadas de los del SERVICE,
 * fichas 0008 y 0012, para el HOST de la 0018): la tarjeta, el estado de un canal (esqueleto,
 * aviso con Reintentar o el valor), un recuento con su nombre y la línea del rango. Los textos
 * siguen en `entities.service.*`: son los mismos para todos los tipos.
 */

/**
 * Tarjeta de un marcador, con el estilo de las de Inicio. No es interactiva. Título y
 * contenido van centrados (ficha 0012), también con la ventana estrecha. La columna no pasa del
 * ancho de la tarjeta (`grid-cols-1`): con cinco por fila, la mediana se parte en dos líneas en
 * vez de desbordar la tarjeta y descentrar el título.
 */
export function MarkerCard({
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
      className="glass grid min-w-0 grid-cols-1 content-start gap-2 rounded-xl p-4 text-center"
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

/** Un recuento con su nombre debajo (abiertos o cerrados). */
export function MarkerCount({
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

/**
 * Estado de un canal dentro de un marcador: esqueleto mientras carga, aviso con
 * Reintentar si falla y, si no, el valor. Sin acceso al módulo, el valor sin dato.
 */
export function QueryState<T>({
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
        centered
        error={query.error}
        busy={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    )
  }
  if (query.data === undefined) return <MarkerSkeleton />
  return children(query.data)
}

export function MarkerSkeleton(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      aria-label={t('entities.service.markers.loading')}
      className="grid justify-items-center gap-2"
    >
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
  onRetry,
  centered = false
}: {
  error: unknown
  busy: boolean
  onRetry: () => void
  /** Centrado, dentro de una tarjeta de marcador (ficha 0012). */
  centered?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const code = error instanceof IpcError ? error.code : null
  const translated = code !== null ? t(`dtErrors.${code}`, { defaultValue: '' }) : ''
  return (
    <div
      role="alert"
      className={cn(
        'grid min-w-0 gap-2 text-sm',
        centered ? 'justify-items-center text-center' : 'justify-items-start'
      )}
    >
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
export function RangeLine({
  resolution,
  testId
}: {
  resolution: string | null
  testId: string
}): JSX.Element {
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
    <p data-testid={testId} className="text-xs text-muted-foreground">
      {parts.join(' · ')}
    </p>
  )
}

/**
 * Nivel de un valor de marcador o de tabla (ficha 0058): el uso de host, proceso o disco y la
 * disponibilidad de monitores (`normal`, `warning`, `error`) y el Apdex y las Core Web Vitals,
 * que añaden `success`.
 */
export type Level = 'normal' | 'success' | 'warning' | 'error'

/** Color del valor según su nivel; el nivel lleva además su texto (el color nunca va solo). */
// Junto a MarkerBody y BigValue, que lo usan: el test de guardia de la ficha 0058 lo busca aquí.
// eslint-disable-next-line react-refresh/only-export-components
export const LEVEL_CLASS: Record<Level, string> = {
  normal: '',
  success: 'text-status-closed',
  warning: 'text-status-warning',
  error: 'text-danger'
}

/**
 * Cuerpo de un marcador: el valor principal; debajo, su nombre (si lo hay), el texto del nivel
 * (si lo hay, con el color de `level`), la línea secundaria (si la hay) y una línea más (`extra`).
 * Los `data-testid` llevan el prefijo del tipo: `host-marker-level`, `process-marker-secondary`…
 */
export function MarkerBody({
  testIdPrefix,
  value,
  caption = null,
  captionTestId,
  levelText = null,
  level = 'normal',
  secondary = null,
  secondaryLevel,
  extra = null
}: {
  /** `host`, `process`, `monitor`…: el de los `data-testid` (`host-marker-level`). */
  testIdPrefix: string
  value: ReactNode
  caption?: ReactNode
  /** `data-testid` del nombre, si lo necesita (la aplicación lo tiene como `…-marker-secondary`). */
  captionTestId?: string
  levelText?: string | null
  level?: Level
  secondary?: ReactNode
  /** Nivel de la línea secundaria, en su color y en `data-level` (las fallidas de un monitor). */
  secondaryLevel?: Level
  extra?: ReactNode
}): JSX.Element {
  return (
    <div className="grid justify-items-center gap-1">
      {value}
      {caption !== null && (
        <p data-testid={captionTestId} className="text-xs text-muted-foreground">
          {caption}
        </p>
      )}
      {levelText !== null && (
        <p
          data-testid={`${testIdPrefix}-marker-level`}
          className={cn('text-xs font-semibold', LEVEL_CLASS[level])}
        >
          {levelText}
        </p>
      )}
      {secondary !== null && (
        <p
          data-testid={`${testIdPrefix}-marker-secondary`}
          data-level={secondaryLevel}
          className={cn(
            'text-sm tabular-nums wrap-anywhere',
            secondaryLevel !== undefined && LEVEL_CLASS[secondaryLevel]
          )}
        >
          {secondary}
        </p>
      )}
      {extra}
    </div>
  )
}

/** Valor principal del marcador, con el color de su nivel (`data-level`). */
export function BigValue({
  testIdPrefix,
  level = 'normal',
  children
}: {
  testIdPrefix: string
  level?: Level
  children: string
}): JSX.Element {
  return (
    <p
      data-testid={`${testIdPrefix}-marker-value`}
      data-level={level}
      className={cn('text-3xl font-semibold tabular-nums wrap-anywhere', LEVEL_CLASS[level])}
    >
      {children}
    </p>
  )
}
