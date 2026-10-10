import { useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { compareCodes, sortRows, type GridSort } from '@shared/grid-sort'
import type { ProcessGroupInstance } from '@shared/modules'
import { entityPath, type EntityLocationState } from '../../app/entity-route'
import { DataGrid, type DataGridColumn } from '../../components/DataGrid'
import { formatBytes, formatUsagePct } from '../../lib/host-format'
import {
  DEFAULT_INSTANCE_SORT,
  hostLabel,
  hostLinkId,
  instanceComparators,
  instanceLinkId,
  type InstanceColumnId
} from './process-group-instances'

/*
 * Tabla de instancias de un PROCESS_GROUP (ficha 0032): nombre, host, CPU media (con barra) y
 * memoria media, de más a menos CPU, con orden por columna. Cada instancia abre su página de
 * proceso y su host, la del host. La usan la tarjeta «Instancias» de la página y el modal «Ver
 * todas» (ficha 0051), cada una con sus testids.
 */

const GRID = 'grid grid-cols-[minmax(8rem,1fr)_minmax(7rem,12rem)_8.5rem_7rem]'
const NUMBER_CELL = 'px-2 py-2 whitespace-nowrap tabular-nums'
const LINK_CLASS =
  'rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]'

const instanceId = (instance: ProcessGroupInstance): string => instance.id
const rowData = (instance: ProcessGroupInstance): Record<string, string> => ({
  'data-instance-id': instance.id
})
/** Desempate fijo por id: el orden no depende de cómo llegaron los datos. */
const byId = (a: ProcessGroupInstance, b: ProcessGroupInstance): number => compareCodes(a.id, b.id)

export function InstancesTable({
  instances,
  gridTestId,
  scrollTestId
}: {
  instances: ProcessGroupInstance[]
  gridTestId: string
  scrollTestId: string
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const navigate = useNavigate()
  const [sort, setSort] = useState<GridSort<InstanceColumnId>>(DEFAULT_INSTANCE_SORT)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const items = sortRows(instances, sort, instanceComparators(lang), [byId])
  const header = (id: InstanceColumnId): string =>
    t(`entities.processGroup.instances.columns.${id}`)

  // Con `fromProblem`, «Volver» va atrás en el historial: el grupo no se vuelve a pedir.
  const linkState = (name: string): EntityLocationState => ({ fromProblem: true, name })
  const open = (instance: ProcessGroupInstance): void => {
    const id = instanceLinkId(instance)
    if (id !== null) {
      void navigate(entityPath('PROCESS_GROUP_INSTANCE', id), { state: linkState(instance.name) })
    }
  }

  const columns: DataGridColumn<ProcessGroupInstance, InstanceColumnId>[] = [
    {
      id: 'name',
      header: header('name'),
      className: 'truncate px-2 py-2 font-medium',
      sortable: 'asc',
      cellTitle: (instance) => instance.name,
      cell: (instance) => {
        const id = instanceLinkId(instance)
        if (id === null) return instance.name
        return (
          <Link
            to={entityPath('PROCESS_GROUP_INSTANCE', id)}
            state={linkState(instance.name)}
            // La fila también abre la instancia: sin esto, se navegaría dos veces.
            onClick={(event) => event.stopPropagation()}
            tabIndex={-1}
            className={LINK_CLASS}
          >
            {instance.name}
          </Link>
        )
      }
    },
    {
      id: 'host',
      header: header('host'),
      className: 'truncate px-2 py-2',
      sortable: 'asc',
      cellTitle: (instance) => hostLabel(instance) ?? '',
      cell: (instance) => {
        const label = hostLabel(instance) ?? '—'
        const id = hostLinkId(instance)
        if (id === null) return label
        return (
          <Link
            to={entityPath('HOST', id)}
            state={linkState(label)}
            // Abre el host, no la instancia de la fila.
            onClick={(event) => event.stopPropagation()}
            tabIndex={-1}
            className={LINK_CLASS}
          >
            {label}
          </Link>
        )
      }
    },
    {
      id: 'cpu',
      header: header('cpu'),
      sortable: 'desc',
      cell: (instance) => <CpuCell pct={instance.cpu} />
    },
    {
      id: 'memory',
      header: header('memory'),
      className: NUMBER_CELL,
      sortable: 'desc',
      cell: (instance) => formatBytes(instance.memory, lang)
    }
  ]

  return (
    <DataGrid
      items={items}
      getId={instanceId}
      columns={columns}
      gridTemplate={GRID}
      sort={sort}
      onSortChange={setSort}
      onActivate={open}
      selected={null}
      rowTestId="process-group-instance-row"
      rowData={rowData}
      gridTestId={gridTestId}
      scrollTestId={scrollTestId}
      ariaLabel={t('entities.processGroup.instances.label')}
      scrollRef={scrollRef}
      className="min-w-[31rem]"
    />
  )
}

/** CPU media con una barra pequeña (la de la tabla de procesos del host). */
function CpuCell({ pct }: { pct: number | null }): JSX.Element {
  const { i18n } = useTranslation()
  const width = pct === null || !Number.isFinite(pct) ? 0 : Math.min(100, Math.max(0, pct))
  return (
    <span className="flex items-center gap-2">
      <span
        data-testid="process-group-instance-cpu-bar"
        aria-hidden="true"
        className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-hover"
      >
        <span className="block h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
      </span>
      <span className="whitespace-nowrap tabular-nums">{formatUsagePct(pct, i18n.language)}</span>
    </span>
  )
}
