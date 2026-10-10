import { useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ProcessGroupMetricsResult } from '@shared/modules'
import type { EntityLocationState } from '../../app/entity-route'
import { ApiWarnings } from '../../components/ModuleState'
import { BUTTON_SECONDARY } from '../../components/styles'
import { MarkerError, MarkerSkeleton } from './EntityMarkers'
import { instancesNotice, instancesTruncated } from './process-group-instances'
import { ProcessGroupInstancesDialog } from './ProcessGroupInstancesDialog'
import { InstancesTable } from './ProcessGroupInstancesTable'

/*
 * Tarjeta «Instancias» de la página de un PROCESS_GROUP (ficha 0032), debajo de los gráficos: las
 * 20 instancias de más CPU (ficha 0050) con nombre, host, CPU media (con barra) y memoria media.
 * Sale de la llamada de los marcadores (`entities:processGroupMetrics`, ficha 0031): si falla,
 * enseña el aviso con Reintentar. Si hay más instancias, el aviso «20 de N» y «Ver todas», que
 * abre el modal con la lista completa (ficha 0051).
 */

/** Sin acceso a Métricas la página no la pinta (como los gráficos). */
export function ProcessGroupInstances({
  metrics,
  envId,
  groupId
}: {
  metrics: UseQueryResult<ProcessGroupMetricsResult>
  envId: string
  groupId: string
}): JSX.Element {
  const { t } = useTranslation()
  const location = useLocation()
  const state = location.state as EntityLocationState | null
  // El nombre del grupo, como el título de la página: el del estado de navegación o el id.
  const groupName = state?.name !== undefined && state.name !== '' ? state.name : groupId
  const [open, setOpen] = useState(false)
  const [requested, setRequested] = useState(false)
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
  } else if (data.instances.items.length === 0) {
    body = (
      <p className="text-sm text-muted-foreground">{t('entities.processGroup.instances.empty')}</p>
    )
  } else {
    const notice = instancesNotice(data)
    body = (
      <>
        <InstancesTable
          instances={data.instances.items}
          gridTestId="process-group-instances-grid"
          scrollTestId="process-group-instances-scroll"
        />
        {notice !== null && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p
              data-testid="process-group-instances-more"
              role="status"
              className="text-sm text-muted-foreground"
            >
              {notice.kind === 'of'
                ? t('entities.processGroup.instances.moreOf', {
                    shown: notice.shown,
                    total: notice.total
                  })
                : t('entities.processGroup.instances.moreUnknown', { shown: notice.shown })}
            </p>
            <button
              type="button"
              data-testid="process-group-instances-all"
              onClick={() => {
                setRequested(true)
                setOpen(true)
              }}
              className={BUTTON_SECONDARY}
            >
              {t('entities.processGroup.instances.viewAll')}
            </button>
          </div>
        )}
        {instancesTruncated(data) && (
          <p
            data-testid="process-group-instances-partial"
            role="status"
            className="text-xs text-status-warning"
          >
            {t('entities.processGroup.instances.partial')}
          </p>
        )}
        <ApiWarnings warnings={data.warnings} />
      </>
    )
  }
  return (
    <section
      data-testid="process-group-instances"
      aria-label={t('entities.processGroup.instances.title')}
      className="glass grid min-w-0 content-start gap-3 rounded-xl p-4"
    >
      <h2 className="text-sm font-semibold">{t('entities.processGroup.instances.title')}</h2>
      {body}
      <ProcessGroupInstancesDialog
        open={open}
        onOpenChange={setOpen}
        requested={requested}
        envId={envId}
        groupId={groupId}
        groupName={groupName}
      />
    </section>
  )
}
