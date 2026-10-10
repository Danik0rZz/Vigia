import { useCallback, useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ApplicationRumResult } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  formatCls,
  webVitalLevel,
  webVitalRating,
  type WebVital
} from '../../lib/application-format'
import { cn } from '../../lib/cn'
import { formatDurationMs } from '../../lib/service-format'
import {
  USER_SECTION_CHARTS,
  sessionStats,
  userChartHasData,
  userChartOption,
  userChartSelector,
  userChartSeries,
  userChartUnit,
  vitalsWithData,
  type UserChartKind
} from './application-rum-users'
import { ApplicationSection } from './ApplicationSection'
import { NO_COLORS, type VisibleRange } from './entity-charts'
import { EntityChartPanel } from './EntityChartPanel'
import { LEVEL_CLASS } from './EntityMarkers'

/**
 * Secciones «Usuarios y sesiones» (usuarios activos y sesiones, con los datos pequeños del rango
 * debajo) y «Experiencia» (tarjetas de LCP, CLS e INP con su calificación y el gráfico de los
 * tres) de la página de una aplicación web (ficha 0054), de `entities:applicationRum` (0052). Un
 * gráfico sin datos no sale, y una sección sin gráficos tampoco; mientras carga, o si falla,
 * salen los gráficos con su aviso y Reintentar, y las tarjetas esperan a los datos. Sin franja de
 * problemas (la ficha no la pide).
 */
export function ApplicationUserSections({
  applicationId,
  rum
}: {
  /** Id ya validado (`applicationEntityIdSchema`). */
  applicationId: string
  rum: UseQueryResult<ApplicationRumResult>
}): JSX.Element {
  const { t } = useTranslation()
  const data = rum.isError ? undefined : rum.data
  const shown = (kinds: readonly UserChartKind[]): UserChartKind[] =>
    kinds.filter((kind) => data === undefined || userChartHasData(data, kind))
  const users = shown(USER_SECTION_CHARTS.users)
  const experience = shown(USER_SECTION_CHARTS.experience)

  return (
    <>
      {users.length > 0 && (
        <ApplicationSection id="users" title={t('entities.application.sections.users')}>
          {users.map((kind) => (
            <UserChartPanel key={kind} kind={kind} applicationId={applicationId} rum={rum} />
          ))}
        </ApplicationSection>
      )}
      {experience.length > 0 && (
        <ApplicationSection
          id="experience"
          title={t('entities.application.sections.experience')}
          columns={false}
        >
          <div className="grid gap-4">
            {data !== undefined && <VitalCards data={data} />}
            {experience.map((kind) => (
              <UserChartPanel key={kind} kind={kind} applicationId={applicationId} rum={rum} />
            ))}
          </div>
        </ApplicationSection>
      )}
    </>
  )
}

/** Un gráfico sobre el panel común (título, «Abrir en Métricas», exportación y aviso). */
function UserChartPanel({
  kind,
  applicationId,
  rum
}: {
  kind: UserChartKind
  applicationId: string
  rum: UseQueryResult<ApplicationRumResult>
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const data = rum.data

  const buildOption = useCallback(
    (loaded: ApplicationRumResult, colors: ChartColors, range: VisibleRange) =>
      userChartOption(kind, userChartSeries(kind, loaded, { colors, t }), loaded.resolution, {
        colors,
        language: i18n.language,
        t,
        range
      }),
    [kind, i18n.language, t]
  )

  // Nombres, puntos y unidad para el DOM (data-series) y la exportación; sin colores.
  const series = useMemo(
    () =>
      data === undefined
        ? []
        : userChartSeries(kind, data, { colors: NO_COLORS, t }).map((item) => ({
            name: item.name,
            points: item.points,
            unit: item.unit
          })),
    [kind, data, t]
  )

  const loaded = data !== undefined && !rum.isError ? data : undefined

  return (
    <EntityChartPanel
      testIdPrefix="application"
      slug={kind}
      title={t(`entities.application.charts.${kind}`)}
      selector={userChartSelector(kind, applicationId, data)}
      query={rum}
      buildOption={buildOption}
      series={series}
      unit={userChartUnit(kind, t)}
      problemList={null}
      note={
        kind === 'activeUsers' ? (
          <p data-testid="application-users-note" className="text-xs text-muted-foreground">
            {t('entities.application.markers.usersEstimatedHint')}
          </p>
        ) : undefined
      }
      footer={
        kind === 'sessions' && loaded !== undefined ? <SessionStats data={loaded} /> : undefined
      }
    />
  )
}

/** Acciones por sesión, tasa de rebote y clics de frustración del rango; los que tienen dato. */
function SessionStats({ data }: { data: ApplicationRumResult }): JSX.Element | null {
  const { t, i18n } = useTranslation()
  const stats = sessionStats(data, i18n.language)
  if (stats.length === 0) return null
  return (
    <dl
      aria-label={t('entities.application.sessionStats.label')}
      className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-xs"
    >
      {stats.map(({ stat, value }) => (
        <div
          key={stat}
          data-testid="application-session-stat"
          data-stat={stat}
          className="grid justify-items-center"
        >
          <dt className="text-muted-foreground">
            {t(`entities.application.sessionStats.${stat}`)}
          </dt>
          <dd
            data-testid="application-session-stat-value"
            className="text-sm font-semibold tabular-nums"
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Las tarjetas de LCP, CLS e INP (las que tienen datos), con el valor del rango y su calificación. */
function VitalCards({ data }: { data: ApplicationRumResult }): JSX.Element | null {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const vitals = vitalsWithData(data)
  if (vitals.length === 0) return null
  const text = (key: string): string => t(`entities.application.vitals.${key}`)
  const format = (vital: WebVital, value: number | null): string =>
    vital === 'cls' ? formatCls(value, lang) : formatDurationMs(value, lang)

  return (
    <div
      role="group"
      aria-label={text('label')}
      className={cn(
        'grid gap-4',
        { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' }[vitals.length]
      )}
    >
      {vitals.map((vital) => {
        const value = data.totals.vitals[vital]
        const rating = webVitalRating(vital, value)
        const level = webVitalLevel(vital, value)
        return (
          <div
            key={vital}
            data-testid="application-vital"
            data-vital={vital}
            className="glass grid content-start justify-items-center gap-1 rounded-xl p-4"
          >
            <VitalLabel label={text(vital)} hint={text(`${vital}Hint`)} />
            <p
              data-testid="application-vital-value"
              className={cn('text-3xl font-semibold tabular-nums', LEVEL_CLASS[level])}
            >
              {format(vital, value)}
            </p>
            {rating !== null && (
              <p
                data-testid="application-vital-rating"
                data-rating={rating}
                data-level={level}
                className={cn('text-xs font-semibold', LEVEL_CLASS[level])}
              >
                {text(`rating.${rating}`)}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Nombre de la métrica, con su explicación en un tooltip que también se abre con el foco. */
function VitalLabel({ label, hint }: { label: string; hint: string }): JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <h3
          data-testid="application-vital-label"
          tabIndex={0}
          className="cursor-help text-sm font-semibold underline decoration-dotted underline-offset-2"
        >
          {label}
        </h3>
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
