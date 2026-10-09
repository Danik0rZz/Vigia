import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { UseQueryResult } from '@tanstack/react-query'
import type { HostLogProcess, HostLogsResult } from '@shared/modules'
import { formatDateTime } from '@shared/format-date'
import { entityPath, type EntityLocationState } from '../../app/entity-route'
import { ModuleUnavailable } from '../../components/ModuleState'
import type { ModuleAccess } from '../../data/modules'
import { cn } from '../../lib/cn'
import { dateLang } from '../../lib/date-lang'
import { MarkerError, MarkerSkeleton } from './EntityMarkers'
import {
  fileStatusKey,
  fileStatusTone,
  sortLogProcesses,
  sourceStateKey,
  type LogStatusTone
} from './host-logs'

/*
 * Tarjeta «Logs» de la página de un HOST (ficha 0041, canal `entities:hostLogs`), antes de
 * «Información»: cuántos procesos del host tienen logs detectados y, de cada uno, el estado del
 * fichero, el de la fuente y la última actualización. Nunca enseña rutas de ficheros (main no
 * las manda). Sin `entities.read`, el aviso del scope; si falla, el aviso con Reintentar y lo
 * demás de la página sigue.
 */

const TONE_CLASS: Record<LogStatusTone, string> = {
  ok: 'text-status-closed',
  error: 'text-danger',
  warning: 'text-status-warning',
  neutral: 'text-muted-foreground'
}

const ROW_GRID =
  'grid grid-cols-[minmax(8rem,1fr)_minmax(7rem,10rem)_minmax(7rem,12rem)_9rem] items-center gap-2'

export function HostLogs({
  access,
  logs
}: {
  access: ModuleAccess
  logs: UseQueryResult<HostLogsResult>
}): JSX.Element | null {
  const { t } = useTranslation()
  // Sin entorno o sin token clásico, nada: ese aviso ya lo da la página.
  if (!access.available && access.reason !== 'missingScope') return null

  const title = t('entities.host.logs.title')
  let body: ReactNode
  if (!access.available) body = <ModuleUnavailable access={access} />
  else if (logs.isError) {
    body = (
      <MarkerError error={logs.error} busy={logs.isFetching} onRetry={() => void logs.refetch()} />
    )
  } else if (logs.data === undefined) body = <MarkerSkeleton />
  else body = <LogsContent data={logs.data} />

  return (
    <section
      data-testid="host-logs"
      aria-label={t('entities.host.logs.label')}
      className="glass grid min-w-0 content-start gap-3 rounded-xl p-4"
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      {body}
    </section>
  )
}

function LogsContent({ data }: { data: HostLogsResult }): JSX.Element {
  const { t, i18n } = useTranslation()
  const summary = (
    <p data-testid="host-logs-summary" className="text-sm text-muted-foreground">
      {t('entities.host.logs.summary', { withLogs: data.withLogs, count: data.total })}
    </p>
  )
  if (data.processes.length === 0) {
    return (
      <>
        <p data-testid="host-logs-empty" className="text-sm text-muted-foreground">
          {t('entities.host.logs.empty')}
        </p>
        {data.total > 0 && summary}
      </>
    )
  }
  const header = (key: string): string => t(`entities.host.logs.columns.${key}`)
  return (
    <>
      {summary}
      <div className="overflow-x-auto">
        <div role="table" aria-label={t('entities.host.logs.label')} className="min-w-[36rem]">
          <div
            role="row"
            className={cn(
              ROW_GRID,
              'border-b border-border px-2 pb-1.5 text-xs text-muted-foreground'
            )}
          >
            <span role="columnheader">{header('name')}</span>
            <span role="columnheader">{header('status')}</span>
            <span role="columnheader">{header('source')}</span>
            <span role="columnheader">{header('updated')}</span>
          </div>
          {sortLogProcesses(data.processes, i18n.language).map((process) => (
            <LogRow key={process.id} process={process} />
          ))}
        </div>
      </div>
    </>
  )
}

function LogRow({ process }: { process: HostLogProcess }): JSX.Element {
  const { t, i18n } = useTranslation()
  // Con `fromProblem`, «Volver» va atrás en el historial: el host no se vuelve a pedir.
  const state: EntityLocationState = { fromProblem: true, name: process.name }
  const status = fileStatusKey(process.fileStatus)
  return (
    <div
      role="row"
      data-testid="host-log-row"
      data-process-id={process.id}
      className={cn(ROW_GRID, 'border-b border-border/50 px-2 py-2 text-sm last:border-b-0')}
    >
      <span role="cell" className="grid min-w-0">
        <Link
          to={entityPath('PROCESS_GROUP_INSTANCE', process.id)}
          state={state}
          title={process.name}
          className="truncate rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
        >
          {process.name}
        </Link>
        <span className="text-xs text-muted-foreground">
          {t('entities.host.logs.sources', { count: process.logCount })}
        </span>
      </span>
      <span
        role="cell"
        data-testid="host-log-status"
        data-status={process.fileStatus ?? 'unknown'}
        className={cn('font-medium', TONE_CLASS[fileStatusTone(process.fileStatus)])}
      >
        {t(`entities.host.logs.fileStatus.${status}`)}
      </span>
      <span role="cell" data-testid="host-log-source" className="text-muted-foreground">
        {t(`entities.host.logs.sourceState.${sourceStateKey(process.sourceState)}`)}
      </span>
      <span role="cell" data-testid="host-log-updated" className="whitespace-nowrap tabular-nums">
        {process.lastUpdate === null
          ? t('entities.host.logs.noUpdate')
          : formatDateTime(process.lastUpdate, dateLang(i18n.language))}
      </span>
    </div>
  )
}
