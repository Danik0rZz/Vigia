import { useRef, useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import type { UseQueryResult } from '@tanstack/react-query'
import { sortRows, type GridSort } from '@shared/grid-sort'
import type { HostBreakdownResult, HostDisk, HostProcess } from '@shared/modules'
import { entityPath, type EntityLocationState } from '../../app/entity-route'
import { DataGrid, type DataGridColumn } from '../../components/DataGrid'
import { ApiWarnings } from '../../components/ModuleState'
import { cn } from '../../lib/cn'
import {
  formatByteRate,
  formatBytes,
  formatUsagePct,
  usageBar,
  type UsageLevel
} from '../../lib/host-format'
import { MarkerError, MarkerSkeleton } from './EntityMarkers'
import {
  DEFAULT_DISK_SORT,
  DEFAULT_PROCESS_SORT,
  byId,
  diskComparators,
  diskLinkId,
  diskTotal,
  processComparators,
  processLinkId,
  processesTruncated,
  type DiskColumnId,
  type ProcessColumnId
} from './host-tables'

/*
 * Tablas de discos y de los 10 procesos con más CPU de la página de un HOST (ficha 0019), debajo
 * de los gráficos. Las dos salen de una sola llamada a `entities:hostBreakdown` (ficha 0017), con
 * el rango global y «Actualizar» de la página: si falla, las dos enseñan el aviso con Reintentar
 * y cualquiera de los dos botones las recarga juntas.
 */

const DISK_GRID = 'grid grid-cols-[minmax(6rem,1fr)_9.5rem_10rem_5.5rem_6rem_6rem]'
const PROCESS_GRID = 'grid grid-cols-[minmax(8rem,1fr)_8.5rem_5.5rem_7rem]'
const NUMBER_CELL = 'px-2 py-2 whitespace-nowrap tabular-nums'

/** Color de la barra según el nivel de uso (el nivel lleva además su texto en la celda). */
const BAR_CLASS: Record<UsageLevel, string> = {
  normal: 'bg-accent',
  warning: 'bg-status-warning',
  error: 'bg-danger'
}
const LEVEL_TEXT_CLASS: Record<UsageLevel, string> = {
  normal: '',
  warning: 'text-status-warning',
  error: 'text-danger'
}

const diskId = (disk: HostDisk): string => disk.id
const diskRowData = (disk: HostDisk): Record<string, string> => ({ 'data-disk-id': disk.id })
const processId = (process: HostProcess): string => process.id
const processRowData = (process: HostProcess): Record<string, string> => ({
  'data-process-id': process.id
})

export function HostTables({
  breakdown
}: {
  breakdown: UseQueryResult<HostBreakdownResult>
}): JSX.Element {
  return (
    // Lado a lado solo con ancho de sobra: la de discos tiene seis columnas.
    <div className="grid gap-4 xl:grid-cols-2">
      <DisksCard breakdown={breakdown} />
      <ProcessesCard breakdown={breakdown} />
    </div>
  )
}

/** Tarjeta de una tabla: título, y carga, aviso de error, vacío o el contenido. */
function TableCard({
  testId,
  title,
  empty,
  breakdown,
  isEmpty,
  children
}: {
  testId: string
  title: string
  empty: string
  breakdown: UseQueryResult<HostBreakdownResult>
  isEmpty: (data: HostBreakdownResult) => boolean
  children: (data: HostBreakdownResult) => ReactNode
}): JSX.Element {
  const data = breakdown.data
  let body: ReactNode
  if (breakdown.isError) {
    body = (
      <MarkerError
        error={breakdown.error}
        busy={breakdown.isFetching}
        onRetry={() => void breakdown.refetch()}
      />
    )
  } else if (data === undefined) {
    body = <MarkerSkeleton />
  } else if (isEmpty(data)) {
    body = <p className="text-sm text-muted-foreground">{empty}</p>
  } else {
    body = children(data)
  }
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="glass grid min-w-0 content-start gap-3 rounded-xl p-4"
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      {body}
    </section>
  )
}

function DisksCard({ breakdown }: { breakdown: UseQueryResult<HostBreakdownResult> }): JSX.Element {
  const { t } = useTranslation()
  return (
    <TableCard
      testId="host-disks"
      title={t('entities.host.disks.title')}
      empty={t('entities.host.disks.empty')}
      breakdown={breakdown}
      isEmpty={(data) => data.disks.length === 0}
    >
      {(data) => (
        <>
          <DisksTable disks={data.disks} />
          <ApiWarnings warnings={data.warnings} />
        </>
      )}
    </TableCard>
  )
}

function DisksTable({ disks }: { disks: HostDisk[] }): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const navigate = useNavigate()
  const [sort, setSort] = useState<GridSort<DiskColumnId>>(DEFAULT_DISK_SORT)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const items = sortRows(disks, sort, diskComparators(lang), [byId])
  const header = (id: DiskColumnId): string => t(`entities.host.disks.columns.${id}`)

  // Ficha 0040: con `fromProblem`, «Volver» va atrás en el historial y el host no se vuelve a pedir.
  const linkState = (disk: HostDisk): EntityLocationState => ({
    fromProblem: true,
    name: disk.name
  })
  const open = (disk: HostDisk): void => {
    const id = diskLinkId(disk)
    if (id !== null) void navigate(entityPath('DISK', id), { state: linkState(disk) })
  }

  const columns: DataGridColumn<HostDisk, DiskColumnId>[] = [
    {
      id: 'name',
      header: header('name'),
      className: 'truncate px-2 py-2 font-medium',
      sortable: 'asc',
      cellTitle: (disk) => disk.name,
      cell: (disk) => {
        const id = diskLinkId(disk)
        if (id === null) return disk.name
        return (
          <Link
            to={entityPath('DISK', id)}
            state={linkState(disk)}
            // La fila también abre el disco: sin esto, se navegaría dos veces.
            onClick={(event) => event.stopPropagation()}
            tabIndex={-1}
            className="rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
          >
            {disk.name}
          </Link>
        )
      }
    },
    {
      id: 'usage',
      header: header('usage'),
      sortable: 'desc',
      cell: (disk) => <UsageCell pct={disk.usedPct.last} />
    },
    {
      id: 'used',
      header: header('used'),
      className: NUMBER_CELL,
      sortable: 'desc',
      cell: (disk) =>
        t('entities.host.disks.usedOfTotal', {
          used: formatBytes(disk.used, lang),
          total: formatBytes(diskTotal(disk), lang)
        })
    },
    {
      id: 'free',
      header: header('free'),
      className: NUMBER_CELL,
      sortable: 'asc',
      cell: (disk) => formatBytes(disk.avail, lang)
    },
    {
      id: 'read',
      header: header('read'),
      className: NUMBER_CELL,
      sortable: 'desc',
      cell: (disk) => formatByteRate(disk.read, lang)
    },
    {
      id: 'write',
      header: header('write'),
      className: NUMBER_CELL,
      sortable: 'desc',
      cell: (disk) => formatByteRate(disk.write, lang)
    }
  ]

  return (
    <DataGrid
      items={items}
      getId={diskId}
      columns={columns}
      gridTemplate={DISK_GRID}
      sort={sort}
      onSortChange={setSort}
      onActivate={open}
      selected={null}
      rowTestId="host-disk-row"
      rowData={diskRowData}
      gridTestId="host-disks-grid"
      scrollTestId="host-disks-scroll"
      ariaLabel={t('entities.host.disks.label')}
      scrollRef={scrollRef}
      className="min-w-[43rem]"
    />
  )
}

/** Barra de uso del disco con su %, y el texto del nivel si pasa del 80 %. */
function UsageCell({ pct }: { pct: number | null }): JSX.Element {
  const { t, i18n } = useTranslation()
  const bar = usageBar(pct, i18n.language)
  return (
    <span className="grid gap-0.5">
      <span className="flex items-center gap-2">
        <span
          data-testid="host-disk-usage"
          data-level={bar.level}
          aria-hidden="true"
          className="h-2 w-14 shrink-0 overflow-hidden rounded-full bg-hover"
        >
          <span
            className={cn('block h-full rounded-full', BAR_CLASS[bar.level])}
            style={{ width: `${bar.width}%` }}
          />
        </span>
        <span
          className={cn('whitespace-nowrap tabular-nums font-medium', LEVEL_TEXT_CLASS[bar.level])}
        >
          {bar.text}
        </span>
      </span>
      {bar.levelKey !== null && (
        <span className={cn('text-xs font-semibold', LEVEL_TEXT_CLASS[bar.level])}>
          {t(bar.levelKey)}
        </span>
      )}
    </span>
  )
}

function ProcessesCard({
  breakdown
}: {
  breakdown: UseQueryResult<HostBreakdownResult>
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <TableCard
      testId="host-processes"
      title={t('entities.host.processes.title')}
      empty={t('entities.host.processes.empty')}
      breakdown={breakdown}
      isEmpty={(data) => data.processes.items.length === 0}
    >
      {(data) => (
        <>
          <ProcessesTable processes={data.processes.items} />
          <p data-testid="host-processes-count" className="text-xs text-muted-foreground">
            {t('entities.host.processes.count', {
              shown: data.processes.items.length,
              count: data.processes.total
            })}
          </p>
          {processesTruncated(data) && (
            <p
              data-testid="host-processes-partial"
              role="status"
              className="text-xs text-status-warning"
            >
              {t('entities.host.processes.partial')}
            </p>
          )}
          <ApiWarnings warnings={data.warnings} />
        </>
      )}
    </TableCard>
  )
}

function ProcessesTable({ processes }: { processes: HostProcess[] }): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const navigate = useNavigate()
  const [sort, setSort] = useState<GridSort<ProcessColumnId>>(DEFAULT_PROCESS_SORT)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const items = sortRows(processes, sort, processComparators(lang), [byId])
  const header = (id: ProcessColumnId): string => t(`entities.host.processes.columns.${id}`)

  // Con `fromProblem`, «Volver» va atrás en el historial: el host no se vuelve a pedir.
  const linkState = (process: HostProcess): EntityLocationState => ({
    fromProblem: true,
    name: process.name
  })
  const open = (process: HostProcess): void => {
    const id = processLinkId(process)
    if (id !== null) {
      void navigate(entityPath('PROCESS_GROUP_INSTANCE', id), { state: linkState(process) })
    }
  }

  const columns: DataGridColumn<HostProcess, ProcessColumnId>[] = [
    {
      id: 'name',
      header: header('name'),
      className: 'truncate px-2 py-2 font-medium',
      sortable: 'asc',
      cellTitle: (process) => process.name,
      cell: (process) => {
        const id = processLinkId(process)
        if (id === null) return process.name
        return (
          <Link
            to={entityPath('PROCESS_GROUP_INSTANCE', id)}
            state={linkState(process)}
            // La fila también abre el proceso: sin esto, se navegaría dos veces.
            onClick={(event) => event.stopPropagation()}
            tabIndex={-1}
            className="rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
          >
            {process.name}
          </Link>
        )
      }
    },
    {
      id: 'cpu',
      header: header('cpu'),
      sortable: 'desc',
      cell: (process) => <CpuCell pct={process.cpu.avg} />
    },
    {
      id: 'cpuMax',
      header: header('cpuMax'),
      className: NUMBER_CELL,
      sortable: 'desc',
      cell: (process) => formatUsagePct(process.cpu.max, lang)
    },
    {
      id: 'memory',
      header: header('memory'),
      className: NUMBER_CELL,
      sortable: 'desc',
      cell: (process) => formatBytes(process.memory, lang)
    }
  ]

  return (
    <DataGrid
      items={items}
      getId={processId}
      columns={columns}
      gridTemplate={PROCESS_GRID}
      sort={sort}
      onSortChange={setSort}
      onActivate={open}
      selected={null}
      rowTestId="host-process-row"
      rowData={processRowData}
      gridTestId="host-processes-grid"
      scrollTestId="host-processes-scroll"
      ariaLabel={t('entities.host.processes.label')}
      scrollRef={scrollRef}
      className="min-w-[29rem]"
    />
  )
}

/** CPU media con una barra pequeña; sin niveles de color (la ficha 0019 los pide en los discos). */
function CpuCell({ pct }: { pct: number | null }): JSX.Element {
  const { i18n } = useTranslation()
  const width = pct === null || !Number.isFinite(pct) ? 0 : Math.min(100, Math.max(0, pct))
  return (
    <span className="flex items-center gap-2">
      <span
        data-testid="host-process-cpu-bar"
        aria-hidden="true"
        className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-hover"
      >
        <span className="block h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
      </span>
      <span className="whitespace-nowrap tabular-nums">{formatUsagePct(pct, i18n.language)}</span>
    </span>
  )
}
