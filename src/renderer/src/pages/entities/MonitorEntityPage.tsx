import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { monitorEntityIdSchema, type MonitorKind } from '@shared/modules'
import { ModuleUnavailable, RefreshButton } from '../../components/ModuleState'
import {
  useEntityProblemCounts,
  useEntityProblems,
  useModuleAccess,
  useModuleRefresh,
  useMonitorBreakdown,
  useMonitorMetrics,
  uniqueUnavailable
} from '../../data/modules'
import { EntityPageFrame, type EntityPageProps } from './EntityPageFrame'
import { MonitorCharts } from './MonitorCharts'
import { MonitorMarkers } from './MonitorMarkers'

/** Prefijo del id de cada tipo de monitor: el de la otra página no se pide aquí. */
const ID_PREFIX: Record<MonitorKind, string> = {
  browser: 'SYNTHETIC_TEST-',
  http: 'HTTP_CHECK-'
}

/**
 * Cuerpo común de las páginas de browser monitor (SYNTHETIC_TEST) y HTTP monitor (HTTP_CHECK),
 * ficha 0024, con el modelo del servicio y del host: marcadores del rango global
 * (disponibilidad, duración, ejecuciones, localizaciones y problemas) y, debajo, los gráficos,
 * con la franja de los problemas del monitor sobre el de la disponibilidad. Marcadores y gráficos
 * salen de una sola llamada a `entities:monitorMetrics` (ficha 0022); las localizaciones, de
 * `entities:monitorBreakdown` (0023). Solo pide datos con «Actualizar» o con un rango nuevo
 * (ADR-0004). Las localizaciones y pasos uno a uno (0025) y la información (0026) van aparte.
 */
export function MonitorEntityPage({
  monitorKind,
  testId,
  ...props
}: EntityPageProps & { monitorKind: MonitorKind; testId: string }): JSX.Element {
  const { t } = useTranslation()
  // Un id que no es de este tipo de monitor no llega a main: el canal lo rechazaría igual.
  const monitorId =
    monitorEntityIdSchema.safeParse(props.id).success && props.id.startsWith(ID_PREFIX[monitorKind])
      ? props.id
      : null
  const metricsAccess = useModuleAccess('metrics')
  const problemsAccess = useModuleAccess('problems')
  const metricsEnv = metricsAccess.available ? metricsAccess.envId : null
  const problemsEnv = problemsAccess.available ? problemsAccess.envId : null
  const metrics = useMonitorMetrics(metricsEnv, monitorId)
  const breakdown = useMonitorBreakdown(metricsEnv, monitorId)
  const problems = useEntityProblemCounts(problemsEnv, monitorId)
  const problemList = useEntityProblems(problemsEnv, monitorId)
  const refresh = useModuleRefresh(metricsEnv ?? problemsEnv, 'entities')
  const canFetch = monitorId !== null && (metricsEnv !== null || problemsEnv !== null)

  return (
    <EntityPageFrame
      {...props}
      testId={testId}
      typeText={t(`entities.types.${monitorKind === 'browser' ? 'SYNTHETIC_TEST' : 'HTTP_CHECK'}`)}
      actions={
        canFetch ? (
          <RefreshButton
            onRefresh={refresh}
            busy={
              metrics.isFetching ||
              breakdown.isFetching ||
              problems.isFetching ||
              problemList.isFetching
            }
          />
        ) : undefined
      }
    >
      {monitorId === null ? (
        <p className="glass rounded-xl p-5 text-sm text-muted-foreground">
          {t(`entities.monitor.invalidId.${monitorKind}`)}
        </p>
      ) : (
        <>
          {uniqueUnavailable([metricsAccess, problemsAccess], t).map((access, index) => (
            <ModuleUnavailable key={index} access={access} />
          ))}
          <MonitorMarkers
            monitorKind={monitorKind}
            metrics={metrics}
            breakdown={breakdown}
            problems={problems}
            metricsEnabled={metricsEnv !== null}
            problemsEnabled={problemsEnv !== null}
          />
          {/* Sin acceso a Métricas no hay datos que dibujar: los marcadores ya enseñan «—». */}
          {metricsEnv !== null && (
            <MonitorCharts
              monitorKind={monitorKind}
              monitorId={monitorId}
              metrics={metrics}
              problemList={problemsEnv !== null ? problemList : null}
            />
          )}
        </>
      )}
    </EntityPageFrame>
  )
}
