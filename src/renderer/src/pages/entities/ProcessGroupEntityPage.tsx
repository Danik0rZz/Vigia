import { useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { processGroupEntityIdSchema } from '@shared/modules'
import { ModuleUnavailable, RefreshButton } from '../../components/ModuleState'
import {
  useEntityInfo,
  useEntityProblemCounts,
  useEntityProblems,
  useModuleAccess,
  useModuleRefresh,
  useProcessGroupMetrics,
  useProcessMetricsList,
  uniqueUnavailable
} from '../../data/modules'
import { useConnectionStatusKnown } from '../../data/tenants'
import { EntityTags } from './EntityTags'
import { EntityPageFrame, EntitySections, type EntityPageProps } from './EntityPageFrame'
import { topInstances } from './process-group-charts'
import { ProcessGroupCharts } from './ProcessGroupCharts'
import { ProcessGroupInfo } from './ProcessGroupInfo'
import { ProcessGroupInstances } from './ProcessGroupInstances'
import { ProcessGroupMarkers } from './ProcessGroupMarkers'

/**
 * Página de análisis de una entidad PROCESS_GROUP (ficha 0032), con el modelo del proceso (0028):
 * marcadores del rango global (instancias, CPU, memoria, red y problemas), los gráficos (CPU,
 * memoria, red y CPU por instancia, con la franja de problemas sobre la CPU), la tabla
 * «Instancias» y, al final, la tarjeta «Información» (`EntitySections`, ficha 0036). Marcadores,
 * gráficos del total y tabla salen de una llamada a `entities:processGroupMetrics` (0031); «CPU
 * por instancia», de `entities:processMetrics` (0027) de las cinco instancias de más CPU, que se
 * piden cuando llegan las instancias (decisión del Orquestador en la ficha). Solo pide datos con
 * «Actualizar» o con un rango nuevo (ADR-0004).
 */
export function ProcessGroupEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  // Un id que no es de process group no llega a main: el canal lo rechazaría igual.
  const groupId = processGroupEntityIdSchema.safeParse(props.id).success ? props.id : null
  const metricsAccess = useModuleAccess('metrics')
  const problemsAccess = useModuleAccess('problems')
  const metricsEnv = metricsAccess.available ? metricsAccess.envId : null
  const problemsEnv = problemsAccess.available ? problemsAccess.envId : null
  const entitiesAccess = useModuleAccess('entities')
  // Sin el resultado de la última prueba no se sabe si falta entities.read: hasta tenerlo, no se pide.
  const statusKnown = useConnectionStatusKnown(
    entitiesAccess.available ? entitiesAccess.envId : null
  )
  const entitiesEnv = entitiesAccess.available && statusKnown ? entitiesAccess.envId : null
  const metrics = useProcessGroupMetrics(metricsEnv, groupId)
  const instances = useMemo(() => topInstances(metrics.data), [metrics.data])
  const instanceIds = useMemo(() => instances.map((instance) => instance.id), [instances])
  const instanceCpu = useProcessMetricsList(metricsEnv, instanceIds)
  const problems = useEntityProblemCounts(problemsEnv, groupId)
  const problemList = useEntityProblems(problemsEnv, groupId)
  const info = useEntityInfo(entitiesEnv, groupId)
  const refresh = useModuleRefresh(metricsEnv ?? problemsEnv ?? entitiesEnv, 'entities')
  const canFetch =
    groupId !== null && (metricsEnv !== null || problemsEnv !== null || entitiesEnv !== null)

  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-process_group"
      typeText={t('entities.types.PROCESS_GROUP')}
      actions={
        canFetch ? (
          <RefreshButton
            onRefresh={refresh}
            busy={
              metrics.isFetching ||
              instanceCpu.isFetching ||
              problems.isFetching ||
              problemList.isFetching ||
              info.isFetching
            }
          />
        ) : undefined
      }
    >
      {groupId === null ? (
        <p className="glass rounded-xl p-5 text-sm text-muted-foreground">
          {t('entities.processGroup.invalidId')}
        </p>
      ) : (
        <EntitySections
          tags={<EntityTags access={entitiesAccess} info={info} />}
          notices={uniqueUnavailable([metricsAccess, problemsAccess], t).map((access, index) => (
            <ModuleUnavailable key={index} access={access} />
          ))}
          markers={
            <ProcessGroupMarkers
              metrics={metrics}
              problems={problems}
              metricsEnabled={metricsEnv !== null}
              problemsEnabled={problemsEnv !== null}
            />
          }
          // Sin acceso a Métricas no hay datos que dibujar: los marcadores ya enseñan «—».
          charts={
            metricsEnv !== null && (
              <ProcessGroupCharts
                groupId={groupId}
                metrics={metrics}
                instances={instances}
                instanceCpu={instanceCpu}
                problemList={problemsEnv !== null ? problemList : null}
              />
            )
          }
          cards={metricsEnv !== null && <ProcessGroupInstances metrics={metrics} />}
          // Al final (0036): si falla, lo demás sigue.
          info={<ProcessGroupInfo access={entitiesAccess} info={info} />}
        />
      )}
    </EntityPageFrame>
  )
}
