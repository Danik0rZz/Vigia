import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { processEntityIdSchema } from '@shared/modules'
import { ModuleUnavailable, RefreshButton } from '../../components/ModuleState'
import {
  useEntityInfo,
  useEntityProblemCounts,
  useEntityProblems,
  useModuleAccess,
  useModuleRefresh,
  useProcessMetrics,
  uniqueUnavailable
} from '../../data/modules'
import { useConnectionStatusKnown } from '../../data/tenants'
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
  // Un id que no es de proceso no llega a main: el canal lo rechazaría igual.
  const processId = processEntityIdSchema.safeParse(props.id).success ? props.id : null
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
  const metrics = useProcessMetrics(metricsEnv, processId)
  const problems = useEntityProblemCounts(problemsEnv, processId)
  const problemList = useEntityProblems(problemsEnv, processId)
  const info = useEntityInfo(entitiesEnv, processId)
  const refresh = useModuleRefresh(metricsEnv ?? problemsEnv ?? entitiesEnv, 'entities')
  const canFetch =
    processId !== null && (metricsEnv !== null || problemsEnv !== null || entitiesEnv !== null)

  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-process_group_instance"
      typeText={t('entities.types.PROCESS_GROUP_INSTANCE')}
      actions={
        canFetch ? (
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
