import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { processEntityIdSchema } from '@shared/modules'
import { ModuleUnavailable, RefreshButton } from '../../components/ModuleState'
import {
  useEntityInfo,
  useEntityProblemCounts,
  useEntityProblems,
  useProcessMetrics,
  uniqueUnavailable
} from '../../data/modules'
import { useEntityPageAccess } from './entity-access'
import { EntityTags } from './EntityTags'
import { EntityPageFrame, EntitySections, type EntityPageProps } from './EntityPageFrame'
import { ProcessCharts } from './ProcessCharts'
import { ProcessInfo } from './ProcessInfo'
import { ProcessMarkers } from './ProcessMarkers'

/**
 * Página de análisis de una entidad PROCESS_GROUP_INSTANCE (ficha 0028), con el modelo del host:
 * marcadores del rango global (CPU, memoria, red, disponibilidad o recursos y problemas) y,
 * debajo, los gráficos (CPU, memoria, red y salud de red o recursos), con la franja de los
 * problemas del proceso sobre el de la CPU. Marcadores y gráficos salen de una sola llamada a
 * `entities:processMetrics` (ficha 0027); lo que no tiene datos no se pinta. Solo pide datos con
 * «Actualizar» o con un rango nuevo (ADR-0004). Al final, la tarjeta «Información» (0029, canal
 * `entities:get`), como en todas las páginas de entidad (`EntitySections`, ficha 0036).
 */
export function ProcessEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  const {
    id: processId,
    metricsAccess,
    problemsAccess,
    entitiesAccess,
    metricsEnv,
    problemsEnv,
    entitiesEnv,
    refresh,
    canRefresh
  } = useEntityPageAccess(props.id, processEntityIdSchema)
  const metrics = useProcessMetrics(metricsEnv, processId)
  const problems = useEntityProblemCounts(problemsEnv, processId)
  const problemList = useEntityProblems(problemsEnv, processId)
  const info = useEntityInfo(entitiesEnv, processId)

  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-process_group_instance"
      typeText={t('entities.types.PROCESS_GROUP_INSTANCE')}
      actions={
        canRefresh ? (
          <RefreshButton
            onRefresh={refresh}
            busy={
              metrics.isFetching || problems.isFetching || problemList.isFetching || info.isFetching
            }
          />
        ) : undefined
      }
    >
      {processId === null ? (
        <p className="glass rounded-xl p-5 text-sm text-muted-foreground">
          {t('entities.process.invalidId')}
        </p>
      ) : (
        <EntitySections
          tags={<EntityTags access={entitiesAccess} info={info} />}
          notices={uniqueUnavailable([metricsAccess, problemsAccess], t).map((access, index) => (
            <ModuleUnavailable key={index} access={access} />
          ))}
          markers={
            <ProcessMarkers
              metrics={metrics}
              problems={problems}
              metricsEnabled={metricsEnv !== null}
              problemsEnabled={problemsEnv !== null}
            />
          }
          // Sin acceso a Métricas no hay datos que dibujar: los marcadores ya enseñan «—».
          charts={
            metricsEnv !== null && (
              <ProcessCharts
                processId={processId}
                metrics={metrics}
                problemList={problemsEnv !== null ? problemList : null}
              />
            )
          }
          // Ficha 0029 (al final desde la 0036): si falla, lo demás sigue.
          info={<ProcessInfo access={entitiesAccess} info={info} />}
        />
      )}
    </EntityPageFrame>
  )
}
