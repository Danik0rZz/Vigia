import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { hostEntityIdSchema } from '@shared/modules'
import { ModuleUnavailable, RefreshButton } from '../../components/ModuleState'
import {
  useEntityProblemCounts,
  useEntityProblems,
  useHostMetrics,
  useModuleAccess,
  useModuleRefresh,
  uniqueUnavailable
} from '../../data/modules'
import { EntityPageFrame, type EntityPageProps } from './EntityPageFrame'
import { HostCharts } from './HostCharts'
import { HostMarkers } from './HostMarkers'

/**
 * Página de análisis de una entidad HOST (ficha 0018), con el modelo del servicio: marcadores
 * del rango global (CPU, memoria, red, disco y problemas) y, debajo, los cuatro gráficos, con la
 * franja de los problemas del host sobre el de la CPU. Marcadores y gráficos salen de una sola
 * llamada a `entities:hostMetrics` (ficha 0016). Solo pide datos con «Actualizar» o con un rango
 * nuevo (ADR-0004).
 */
export function HostEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  // Un id que no es de host no llega a main: el canal lo rechazaría igual.
  const hostId = hostEntityIdSchema.safeParse(props.id).success ? props.id : null
  const metricsAccess = useModuleAccess('metrics')
  const problemsAccess = useModuleAccess('problems')
  const metricsEnv = metricsAccess.available ? metricsAccess.envId : null
  const problemsEnv = problemsAccess.available ? problemsAccess.envId : null
  const metrics = useHostMetrics(metricsEnv, hostId)
  const problems = useEntityProblemCounts(problemsEnv, hostId)
  const problemList = useEntityProblems(problemsEnv, hostId)
  const refresh = useModuleRefresh(metricsEnv ?? problemsEnv, 'entities')
  const canFetch = hostId !== null && (metricsEnv !== null || problemsEnv !== null)

  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-host"
      typeText={t('entities.types.HOST')}
      actions={
        canFetch ? (
          <RefreshButton
            onRefresh={refresh}
            busy={metrics.isFetching || problems.isFetching || problemList.isFetching}
          />
        ) : undefined
      }
    >
      {hostId === null ? (
        <p className="glass rounded-xl p-5 text-sm text-muted-foreground">
          {t('entities.host.invalidId')}
        </p>
      ) : (
        <>
          {uniqueUnavailable([metricsAccess, problemsAccess], t).map((access, index) => (
            <ModuleUnavailable key={index} access={access} />
          ))}
          <HostMarkers
            metrics={metrics}
            problems={problems}
            metricsEnabled={metricsEnv !== null}
            problemsEnabled={problemsEnv !== null}
          />
          {/* Sin acceso a Métricas no hay datos que dibujar: los marcadores ya enseñan «—». */}
          {metricsEnv !== null && (
            <HostCharts
              hostId={hostId}
              metrics={metrics}
              problemList={problemsEnv !== null ? problemList : null}
            />
          )}
        </>
      )}
    </EntityPageFrame>
  )
}
