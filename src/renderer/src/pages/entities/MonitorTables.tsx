import { useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import { sortRows, type GridSort } from '@shared/grid-sort'
import type {
  MonitorBreakdownResult,
  MonitorKind,
  MonitorLocation,
  MonitorStep
} from '@shared/modules'
import { DataGrid, type DataGridColumn } from '../../components/DataGrid'
import { ApiWarnings } from '../../components/ModuleState'
import { cn } from '../../lib/cn'
import { formatUsagePct } from '../../lib/host-format'
import { availabilityLevel, formatAvailabilityPct } from '../../lib/monitor-format'
import { formatCount, formatDurationMs } from '../../lib/service-format'
import { LEVEL_CLASS } from './EntityMarkers'
import { BAR_CLASS, NUMBER_CELL, TableCard, barWidth } from './EntityTables'
import { byId } from './host-tables'
import {
  DEFAULT_LOCATION_SORT,
  DEFAULT_STEP_SORT,
  locationComparators,
  monitorStepsShown,
  slowestStepId,
  stepComparators,
  type LocationColumnId,
  type StepColumnId
} from './monitor-tables'

/*
 * Tablas de localizaciones y de pasos (browser) o peticiones (HTTP) de las páginas de monitor
 * (ficha 0025), debajo de los gráficos. Las dos salen de la misma llamada a
 * `entities:monitorBreakdown` (ficha 0023) que el marcador «Localizaciones»: si falla, las dos
 * enseñan el aviso con Reintentar y cualquiera de los botones las recarga juntas. Pulsar una
 * localización no filtra los gráficos (fuera de alcance).
 */

const LOCATION_GRID = 'grid grid-cols-[minmax(8rem,1fr)_12rem_6rem_5.5rem]'
const STEP_GRID = 'grid grid-cols-[minmax(8rem,1fr)_6rem_9rem]'

const locationId = (location: MonitorLocation): string => location.id
const locationRowData = (location: MonitorLocation): Record<string, string> => ({
  'data-location-id': location.id
})
const stepId = (step: MonitorStep): string => step.id

export function MonitorTables({
  monitorKind,
  breakdown
}: {
  monitorKind: MonitorKind
  breakdown: UseQueryResult<MonitorBreakdownResult>
}): JSX.Element {
  return (
    // Una columna si es estrecha; lado a lado con ancho de sobra.
    <div className="grid gap-4 xl:grid-cols-2">
      <LocationsCard breakdown={breakdown} />
      {monitorStepsShown(breakdown.data) && (
        <StepsCard monitorKind={monitorKind} breakdown={breakdown} />
      )}
    </div>
  )
}

function LocationsCard({
  breakdown
}: {
  breakdown: UseQueryResult<MonitorBreakdownResult>
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <TableCard
      testId="monitor-locations"
      title={t('entities.monitor.locations.title')}
      empty={t('entities.monitor.locations.empty')}
      query={breakdown}
      isEmpty={(data) => data.locations.length === 0}
    >
      {(data) => (
        <>
          <LocationsTable locations={data.locations} />
          <ApiWarnings warnings={data.warnings} />
        </>
      )}
    </TableCard>
  )
}

function LocationsTable({ locations }: { locations: MonitorLocation[] }): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [sort, setSort] = useState<GridSort<LocationColumnId>>(DEFAULT_LOCATION_SORT)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const items = sortRows(locations, sort, locationComparators(lang), [byId])
  const header = (id: LocationColumnId): string => t(`entities.monitor.locations.columns.${id}`)

  const columns: DataGridColumn<MonitorLocation, LocationColumnId>[] = [
    {
      id: 'name',
      header: header('name'),
      className: 'truncate px-2 py-2 font-medium',
      sortable: 'asc',
      cellTitle: (location) => location.name,
      cell: (location) => location.name
    },
    {
      id: 'availability',
      header: header('availability'),
      sortable: 'asc',
      cell: (location) => <AvailabilityCell pct={location.availability} />
    },
    {
      id: 'duration',
      header: header('duration'),
      className: NUMBER_CELL,
      sortable: 'desc',
      cell: (location) => formatDurationMs(location.duration, lang)
    },
    {
      id: 'failed',
      header: header('failed'),
      className: NUMBER_CELL,
      sortable: 'desc',
      // Null solo en browser (sin métrica de fallidas por localización): «—».
      cell: (location) => formatCount(location.failed, lang)
    }
  ]

  return (
    <DataGrid
      items={items}
      getId={locationId}
      columns={columns}
      gridTemplate={LOCATION_GRID}
      sort={sort}
      onSortChange={setSort}
      // Filtrar los gráficos por localización queda fuera de alcance (ficha 0025).
      onActivate={() => undefined}
      selected={null}
      rowTestId="monitor-location-row"
      rowData={locationRowData}
      gridTestId="monitor-locations-grid"
      scrollTestId="monitor-locations-scroll"
      ariaLabel={t('entities.monitor.locations.label')}
      scrollRef={scrollRef}
      className="min-w-[31.5rem]"
    />
  )
}

/** Barra de disponibilidad con su %, con el color y el texto del nivel (umbrales de la 0024). */
function AvailabilityCell({ pct }: { pct: number | null }): JSX.Element {
  const { t, i18n } = useTranslation()
  const level = availabilityLevel(pct)
  return (
    <span className="grid gap-0.5 px-2 py-1">
      <span className="flex items-center gap-2">
        <span
          data-testid="monitor-location-availability"
          data-level={level}
          aria-hidden="true"
          className="h-2 w-14 shrink-0 overflow-hidden rounded-full bg-hover"
        >
          <span
            className={cn('block h-full rounded-full', BAR_CLASS[level])}
            style={{ width: `${barWidth(pct)}%` }}
          />
        </span>
        <span className={cn('whitespace-nowrap tabular-nums font-medium', LEVEL_CLASS[level])}>
          {formatAvailabilityPct(pct, i18n.language)}
        </span>
      </span>
      {level !== 'normal' && (
        <span
          data-testid="monitor-location-level"
          className={cn('text-xs font-semibold', LEVEL_CLASS[level])}
        >
          {t(`entities.monitor.markers.levels.${level}`)}
        </span>
      )}
    </span>
  )
}

function StepsCard({
  monitorKind,
  breakdown
}: {
  monitorKind: MonitorKind
  breakdown: UseQueryResult<MonitorBreakdownResult>
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <TableCard
      testId="monitor-steps"
      title={t(
        monitorKind === 'browser'
          ? 'entities.monitor.steps.titleBrowser'
          : 'entities.monitor.steps.titleHttp'
      )}
      empty={t('entities.monitor.steps.empty')}
      query={breakdown}
      isEmpty={(data) => data.steps === null || data.steps.length === 0}
    >
      {(data) => <StepsTable monitorKind={monitorKind} steps={data.steps ?? []} />}
    </TableCard>
  )
}

function StepsTable({
  monitorKind,
  steps
}: {
  monitorKind: MonitorKind
  steps: MonitorStep[]
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [sort, setSort] = useState<GridSort<StepColumnId>>(DEFAULT_STEP_SORT)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const items = sortRows(steps, sort, stepComparators(lang), [byId])
  const slowest = slowestStepId(steps)
  const header = (id: StepColumnId): string => t(`entities.monitor.steps.columns.${id}`)
  const rowData = (step: MonitorStep): Record<string, string> =>
    step.id === slowest
      ? { 'data-step-id': step.id, 'data-slowest': 'true' }
      : { 'data-step-id': step.id }

  const columns: DataGridColumn<MonitorStep, StepColumnId>[] = [
    {
      id: 'name',
      header: header('name'),
      className: 'min-w-0 px-2 py-2 font-medium',
      sortable: 'asc',
      cellTitle: (step) => step.name,
      cell: (step) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{step.name}</span>
          {step.id === slowest && (
            <span
              data-testid="monitor-step-slowest"
              className="shrink-0 rounded-full bg-status-warning/15 px-2 py-0.5 text-xs font-semibold text-status-warning"
            >
              {t('entities.monitor.steps.slowest')}
            </span>
          )}
        </span>
      )
    },
    {
      id: 'duration',
      header: header('duration'),
      className: NUMBER_CELL,
      sortable: 'desc',
      cell: (step) => formatDurationMs(step.duration, lang)
    },
    {
      id: 'share',
      header: header('share'),
      sortable: 'desc',
      cell: (step) => (
        <span className="flex items-center gap-2 px-2 py-2">
          <span
            data-testid="monitor-step-share"
            aria-hidden="true"
            className="h-2 w-14 shrink-0 overflow-hidden rounded-full bg-hover"
          >
            <span
              className={cn(
                'block h-full rounded-full',
                step.id === slowest ? 'bg-status-warning' : 'bg-accent'
              )}
              style={{ width: `${barWidth(step.share)}%` }}
            />
          </span>
          <span className="whitespace-nowrap tabular-nums">{formatUsagePct(step.share, lang)}</span>
        </span>
      )
    }
  ]

  return (
    <DataGrid
      items={items}
      getId={stepId}
      columns={columns}
      gridTemplate={STEP_GRID}
      sort={sort}
      onSortChange={setSort}
      // Un paso no tiene página propia que abrir.
      onActivate={() => undefined}
      selected={null}
      rowTestId="monitor-step-row"
      rowData={rowData}
      gridTestId="monitor-steps-grid"
      scrollTestId="monitor-steps-scroll"
      ariaLabel={t(
        monitorKind === 'browser'
          ? 'entities.monitor.steps.labelBrowser'
          : 'entities.monitor.steps.labelHttp'
      )}
      scrollRef={scrollRef}
      className="min-w-[23rem]"
    />
  )
}
