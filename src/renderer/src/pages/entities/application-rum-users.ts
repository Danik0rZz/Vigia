import type { TFunction } from 'i18next'
import type { EChartsCoreOption } from 'echarts/core'
import type { ApplicationRumResult, ServiceSeries } from '@shared/modules'
import { formatNumber } from '@shared/format-number'
import type { ChartColors } from '../../components/Chart'
import { axisTooltip, timeAxisLabel } from '../../components/chart-time'
import {
  WEB_VITALS,
  WEB_VITAL_THRESHOLDS,
  formatCls,
  type WebVital
} from '../../lib/application-format'
import { formatCount, formatDurationMs, formatErrorRate } from '../../lib/service-format'
import type { ApplicationChartContext, ApplicationChartSeries } from './application-charts'
import { hasData } from './application-rum-charts'

/**
 * Secciones «Usuarios y sesiones» y «Experiencia» (Core Web Vitals) de la página de una
 * aplicación web (ficha 0054), sacadas de la misma respuesta de `entities:applicationRum` (ficha
 * 0052) que las de la 0053. Solo métricas clásicas de RUM. Una serie sin datos no sale, y un
 * gráfico sin series tampoco. Puras: el componente pone React.
 */
export type UserChartKind = 'activeUsers' | 'sessions' | 'vitals'

/** Los gráficos de cada sección, en su orden. */
export const USER_SECTION_CHARTS = {
  users: ['activeUsers', 'sessions'],
  experience: ['vitals']
} as const satisfies Record<string, readonly UserChartKind[]>

/** Una serie con su eje (0 a la izquierda, 1 a la derecha), su unidad y su umbral de «bueno». */
export interface UserChartSeries extends ApplicationChartSeries {
  axis: 0 | 1
  /** Unidad de los valores, para la exportación. */
  unit: string
  /** Umbral de «bueno» (línea discontinua); solo los Core Web Vitals. */
  threshold?: number
}

type SessionRole = 'startedSessions' | 'endedSessions' | 'sessionDuration'
const SESSION_ROLES: readonly SessionRole[] = [
  'startedSessions',
  'endedSessions',
  'sessionDuration'
]

function sessionSeries(
  data: ApplicationRumResult,
  role: SessionRole
): [ServiceSeries, number | null] {
  switch (role) {
    case 'startedSessions':
      return [data.series.sessions.started, data.totals.sessions.started]
    case 'endedSessions':
      return [data.series.sessions.ended, data.totals.sessions.ended]
    case 'sessionDuration':
      return [data.series.sessionDuration, data.totals.sessionDuration]
  }
}

/** Papeles de sesión con datos, en su orden (iniciadas, terminadas y duración media). */
export function sessionRolesWithData(data: ApplicationRumResult): SessionRole[] {
  return SESSION_ROLES.filter((role) => hasData(...sessionSeries(data, role)))
}

/** Core Web Vitals con datos, en su orden (LCP, CLS e INP). */
export function vitalsWithData(data: ApplicationRumResult): WebVital[] {
  return WEB_VITALS.filter((vital) => hasData(data.series.vitals[vital], data.totals.vitals[vital]))
}

/** ¿Tiene datos el gráfico? Si no, no se pinta (CA4 de la ficha). */
export function userChartHasData(data: ApplicationRumResult, kind: UserChartKind): boolean {
  switch (kind) {
    case 'activeUsers':
      return hasData(data.series.activeUsers, data.totals.activeUsers)
    case 'sessions':
      return sessionRolesWithData(data).length > 0
    case 'vitals':
      return vitalsWithData(data).length > 0
  }
}

function points(series: ServiceSeries, scale = 1): [number, number | null][] {
  return series.timestamps.map((time, index) => {
    const value = series.values[index] ?? null
    return [time, value === null ? null : value * scale]
  })
}

function sessionColor(role: SessionRole, colors: ChartColors): string {
  return {
    startedSessions: colors.accent,
    endedSessions: colors.series2,
    sessionDuration: colors.series3
  }[role]
}

function vitalColor(vital: WebVital, colors: ChartColors): string {
  return { lcp: colors.accent, cls: colors.series2, inp: colors.series3 }[vital]
}

/**
 * Las series del gráfico, con su nombre, color, eje y unidad; solo las que traen datos. La
 * duración de sesión llega en microsegundos y se pasa a ms. En los Core Web Vitals, LCP e INP
 * van en el eje del tiempo y CLS (sin unidad) en el suyo.
 */
export function userChartSeries(
  kind: UserChartKind,
  data: ApplicationRumResult,
  { colors, t }: Pick<ApplicationChartContext, 'colors' | 't'>
): UserChartSeries[] {
  const name = (key: string): string => t(`entities.application.charts.series.${key}`)
  switch (kind) {
    case 'activeUsers':
      return [
        {
          name: name('activeUsers'),
          color: colors.accent,
          points: points(data.series.activeUsers),
          axis: 0,
          unit: t('entities.application.charts.units.users')
        }
      ]
    case 'sessions':
      return sessionRolesWithData(data).map((role) => {
        const duration = role === 'sessionDuration'
        return {
          name: name(role),
          color: sessionColor(role, colors),
          points: points(sessionSeries(data, role)[0], duration ? 1 / 1000 : 1),
          axis: duration ? 1 : 0,
          unit: duration ? 'ms' : t('entities.application.charts.units.sessions')
        }
      })
    case 'vitals':
      return vitalsWithData(data).map((vital) => ({
        name: name(vital),
        color: vitalColor(vital, colors),
        points: points(data.series.vitals[vital]),
        axis: vital === 'cls' ? 1 : 0,
        unit: vital === 'cls' ? '' : 'ms',
        threshold: WEB_VITAL_THRESHOLDS[vital][0]
      }))
  }
}

/** Formato de los valores de cada eje (0, izquierda; 1, derecha). */
function axisFormatters(
  kind: UserChartKind,
  language: string
): [(value: number) => string, (value: number) => string] {
  const count = (value: number): string => formatCount(value, language)
  const millis = (value: number): string => formatDurationMs(value, language)
  switch (kind) {
    case 'activeUsers':
      return [count, count]
    case 'sessions':
      return [count, millis]
    case 'vitals':
      return [millis, (value) => formatCls(value, language)]
  }
}

/**
 * Opción de ECharts: sin líneas de rejilla, con los márgenes de las demás páginas y la leyenda
 * con más de una serie. Sesiones iniciadas y terminadas en barras (una al lado de la otra) y la
 * duración media en línea, en el eje de la derecha; los Core Web Vitals en línea, con CLS a la
 * derecha y una línea discontinua en el umbral de «bueno» de cada uno.
 */
export function userChartOption(
  kind: UserChartKind,
  list: UserChartSeries[],
  resolution: string,
  context: ApplicationChartContext
): EChartsCoreOption {
  const { colors, language, range } = context
  const formats = axisFormatters(kind, language)
  const twoAxes = list.some((item) => item.axis === 1)
  // El tooltip formatea cada serie con el formato de su eje.
  const byName = new Map(list.map((item) => [item.name, formats[item.axis]]))
  const axis = (index: 0 | 1): Record<string, unknown> => ({
    type: 'value',
    min: 0,
    position: index === 0 ? 'left' : 'right',
    // Sin líneas de rejilla (ficha 0012): se quedan las etiquetas y el eje X.
    splitLine: { show: false },
    axisLabel: { color: colors.muted, formatter: formats[index] }
  })
  return {
    animation: false,
    grid: { left: 64, right: twoAxes ? 64 : 16, top: list.length > 1 ? 28 : 12, bottom: 28 },
    tooltip: axisTooltip(language, formats[0], (seriesName) => byName.get(seriesName)),
    legend: {
      show: list.length > 1,
      top: 0,
      textStyle: { color: colors.muted },
      inactiveColor: colors.border
    },
    xAxis: {
      type: 'time',
      ...(range === undefined ? {} : { min: range.from, max: range.to }),
      axisLine: { lineStyle: { color: colors.border } },
      axisLabel: { color: colors.muted, ...timeAxisLabel(language, resolution) }
    },
    yAxis: twoAxes ? [axis(0), axis(1)] : axis(0),
    series: list.map((item) => {
      const common = {
        name: item.name,
        ...(twoAxes ? { yAxisIndex: item.axis } : {}),
        itemStyle: { color: item.color },
        data: item.points
      }
      if (kind === 'sessions' && item.axis === 0) {
        return { type: 'bar', barMaxWidth: 16, ...common }
      }
      return {
        type: 'line',
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: item.color, width: 1.75 },
        ...common,
        ...(item.threshold === undefined
          ? {}
          : {
              markLine: {
                silent: true,
                symbol: 'none',
                lineStyle: { type: 'dashed', color: item.color, width: 1 },
                label: { show: false },
                data: [{ yAxis: item.threshold }]
              }
            })
      }
    })
  }
}

/** Unidad de los valores de cada gráfico, para la exportación (cada serie lleva la suya). */
export function userChartUnit(kind: UserChartKind, t: TFunction): string {
  switch (kind) {
    case 'activeUsers':
      return t('entities.application.charts.units.users')
    case 'sessions':
      return t('entities.application.charts.units.sessions')
    case 'vitals':
      return 'ms'
  }
}

const W = 'builtin:apps.web.'

/**
 * Consulta de Métricas de cada gráfico («Abrir en Métricas» y exportación), con las métricas y
 * agregaciones de main (ficha 0052), una expresión por serie pintada (todas mientras no hay
 * datos). La aplicación va en un `:filter(eq("dt.entity.application",…))`, como en la 0053; el
 * id llega ya validado (`applicationEntityIdSchema`).
 */
export function userChartSelector(
  kind: UserChartKind,
  entityId: string,
  data: ApplicationRumResult | undefined
): string {
  const filter = `:filter(eq("dt.entity.application","${entityId}"))`
  switch (kind) {
    case 'activeUsers':
      return `${W}activeUsersEst${filter}:splitBy()`
    case 'sessions': {
      const metric: Record<SessionRole, string> = {
        startedSessions: `startedSessions${filter}:splitBy():sum`,
        endedSessions: `endedSessions${filter}:splitBy():sum`,
        sessionDuration: `sessionDuration${filter}:splitBy():avg`
      }
      const shown = data === undefined ? [] : sessionRolesWithData(data)
      return (shown.length === 0 ? SESSION_ROLES : shown)
        .map((role) => `${W}${metric[role]}`)
        .join(',')
    }
    case 'vitals': {
      const metric: Record<WebVital, string> = {
        lcp: 'largestContentfulPaint.load.browser',
        cls: 'cumulativeLayoutShift.load.browser',
        inp: 'interactionToNextPaint'
      }
      const shown = data === undefined ? [] : vitalsWithData(data)
      return (shown.length === 0 ? WEB_VITALS : shown)
        .map((vital) => `${W}${metric[vital]}${filter}:splitBy():percentile(75)`)
        .join(',')
    }
  }
}

/** Los datos pequeños bajo el gráfico de sesiones, en su orden. */
export const SESSION_STATS = ['actionsPerSession', 'bounceRate', 'rageClicks'] as const
export type SessionStat = (typeof SESSION_STATS)[number]

/**
 * Los datos pequeños del rango con dato, ya formateados: acciones por sesión (un decimal),
 * tasa de rebote (%) y clics de frustración (recuento). Sin dato, no salen (los rage clicks no
 * traen datos en vivo).
 */
export function sessionStats(
  data: ApplicationRumResult,
  language: string
): { stat: SessionStat; value: string }[] {
  const totals: Record<SessionStat, number | null> = {
    actionsPerSession: data.totals.actionsPerSession,
    bounceRate: data.totals.bounceRate,
    rageClicks: data.totals.rageClicks
  }
  const format: Record<SessionStat, (value: number) => string> = {
    actionsPerSession: (value) =>
      formatNumber(value, language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    bounceRate: (value) => formatErrorRate(value, language),
    rageClicks: (value) => formatCount(value, language)
  }
  return SESSION_STATS.flatMap((stat) => {
    const value = totals[stat]
    return value === null || !Number.isFinite(value) ? [] : [{ stat, value: format[stat](value) }]
  })
}
