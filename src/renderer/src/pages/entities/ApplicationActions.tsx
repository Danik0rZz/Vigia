import { useRef, useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import { compareCodes, sortRows, type GridSort } from '@shared/grid-sort'
import type { ApplicationAction, ApplicationMetricsResult } from '@shared/modules'
import { DataGrid, type DataGridColumn } from '../../components/DataGrid'
import { ApiWarnings } from '../../components/ModuleState'
import { formatCount, formatDurationMs } from '../../lib/service-format'
import {
  DEFAULT_ACTION_SORT,
  actionComparators,
  durationShare,
  type ActionColumnId
} from './application-actions'
import { MarkerError, MarkerSkeleton } from './EntityMarkers'

/*
 * Tabla de acciones de la página de una aplicación web (ficha 0034), en la sección «Acciones
 * clave» (ficha 0053, que pone el título): las 10 acciones de más volumen del rango (nombre,
 * número de acciones y duración media con barra), de más a menos acciones. Sale de la llamada de los marcadores
 * (`entities:applicationMetrics`, ficha 0033): si falla, enseña el aviso con Reintentar. En vivo
 * la lista suele llegar vacía (solo traen datos las acciones clave): entonces lo dice, sin aviso
 * de error.
 */

const GRID = 'grid grid-cols-[minmax(10rem,1fr)_7rem_9.5rem]'
const NUMBER_CELL = 'px-2 py-2 whitespace-nowrap tabular-nums'

const actionId = (action: ApplicationAction): string => action.id
const rowData = (action: ApplicationAction): Record<string, string> => ({
  'data-action-id': action.id
})
/** Desempate fijo por id: el orden no depende de cómo llegaron los datos. */
const byId = (a: ApplicationAction, b: ApplicationAction): number => compareCodes(a.id, b.id)

/** Sin acceso a Métricas la página no la pinta (como los gráficos). */
export function ApplicationActions({
  metrics
}: {
  metrics: UseQueryResult<ApplicationMetricsResult>
}): JSX.Element {
  const { t } = useTranslation()
  const data = metrics.data
  let body: ReactNode
  if (metrics.isError) {
    body = (
      <MarkerError
        error={metrics.error}
        busy={metrics.isFetching}
        onRetry={() => void metrics.refetch()}
      />
    )
  } else if (data === undefined) {
    body = <MarkerSkeleton />
  } else if (data.topActions.length === 0) {
    body = (
      <p data-testid="application-actions-empty" className="text-sm text-muted-foreground">
        {t('entities.application.actions.empty')}
      </p>
    )
  } else {
    body = (
      <>
        <ActionsTable actions={data.topActions} />
        <ApiWarnings warnings={data.warnings} />
      </>
    )
  }
  return (
    <section
      data-testid="application-actions"
      aria-label={t('entities.application.actions.title')}
      className="glass grid min-w-0 content-start gap-3 rounded-xl p-4"
    >
      {body}
    </section>
  )
}

function ActionsTable({ actions }: { actions: ApplicationAction[] }): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [sort, setSort] = useState<GridSort<ActionColumnId>>(DEFAULT_ACTION_SORT)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const items = sortRows(actions, sort, actionComparators(lang), [byId])
  const header = (id: ActionColumnId): string => t(`entities.application.actions.columns.${id}`)

  const columns: DataGridColumn<ApplicationAction, ActionColumnId>[] = [
    {
      id: 'name',
      header: header('name'),
      className: 'truncate px-2 py-2 font-medium',
      sortable: 'asc',
      cellTitle: (action) => action.name,
      cell: (action) => action.name
    },
    {
      id: 'count',
      header: header('count'),
      className: NUMBER_CELL,
      sortable: 'desc',
      cell: (action) => formatCount(action.count, lang)
    },
    {
      id: 'duration',
      header: header('duration'),
      sortable: 'desc',
      cell: (action) => <DurationCell action={action} actions={actions} />
    }
  ]

  return (
    <DataGrid
      items={items}
      getId={actionId}
      columns={columns}
      gridTemplate={GRID}
      sort={sort}
      onSortChange={setSort}
      // Las acciones no tienen página propia: la fila no abre nada.
      onActivate={() => undefined}
      selected={null}
      rowTestId="application-action-row"
      rowData={rowData}
      gridTestId="application-actions-grid"
      scrollTestId="application-actions-scroll"
      ariaLabel={t('entities.application.actions.label')}
      scrollRef={scrollRef}
      className="min-w-[26.5rem]"
    />
  )
}

/** Duración media con una barra pequeña, frente a la más lenta de la tabla. */
function DurationCell({
  action,
  actions
}: {
  action: ApplicationAction
  actions: readonly ApplicationAction[]
}): JSX.Element {
  const { i18n } = useTranslation()
  return (
    <span className="flex items-center gap-2">
      <span
        data-testid="application-action-duration-bar"
        aria-hidden="true"
        className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-hover"
      >
        <span
          className="block h-full rounded-full bg-accent"
          style={{ width: `${durationShare(action.duration, actions)}%` }}
        />
      </span>
      <span className="whitespace-nowrap tabular-nums">
        {formatDurationMs(action.duration, i18n.language)}
      </span>
    </span>
  )
}
