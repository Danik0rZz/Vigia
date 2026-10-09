import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { applicationEntityIdSchema } from '@shared/modules'
import { ModuleUnavailable, RefreshButton } from '../../components/ModuleState'
import {
  useApplicationMetrics,
  useEntityInfo,
  useEntityProblemCounts,
  useEntityProblems,
  useModuleAccess,
  useModuleRefresh,
  uniqueUnavailable
} from '../../data/modules'
import { useConnectionStatusKnown } from '../../data/tenants'
import { ApplicationActions } from './ApplicationActions'
import { ApplicationCharts } from './ApplicationCharts'
import { ApplicationInfo } from './ApplicationInfo'
import { ApplicationMarkers } from './ApplicationMarkers'
import { EntityTags } from './EntityTags'
import { EntityPageFrame, EntitySections, type EntityPageProps } from './EntityPageFrame'

/**
 * Página de análisis de una entidad APPLICATION, una aplicación web (ficha 0034), con el modelo
 * del servicio y el orden de las fichas 0036 y 0037: marcadores del rango global (Apdex,
 * acciones, duración, errores y problemas), los gráficos (Apdex con la franja de problemas,
 * acciones, duración y errores), la tabla «Acciones de usuario» y, al final, la tarjeta
 * «Información». Marcadores, gráficos y tabla salen de una llamada a
 * `entities:applicationMetrics` (0033). Solo pide datos con «Actualizar» o con un rango nuevo
 * (ADR-0004).
 */
export function WebApplicationEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  // Un id que no es de aplicación no llega a main: el canal lo rechazaría igual.
  const applicationId = applicationEntityIdSchema.safeParse(props.id).success ? props.id : null
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
  const metrics = useApplicationMetrics(metricsEnv, applicationId)
  const problems = useEntityProblemCounts(problemsEnv, applicationId)
  const problemList = useEntityProblems(problemsEnv, applicationId)
  const info = useEntityInfo(entitiesEnv, applicationId)
  const refresh = useModuleRefresh(metricsEnv ?? problemsEnv ?? entitiesEnv, 'entities')
  const canFetch =
    applicationId !== null && (metricsEnv !== null || problemsEnv !== null || entitiesEnv !== null)

  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-application"
      typeText={t('entities.types.APPLICATION')}
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
      {applicationId === null ? (
        <p className="glass rounded-xl p-5 text-sm text-muted-foreground">
          {t('entities.application.invalidId')}
        </p>
      ) : (
        <EntitySections
          tags={<EntityTags access={entitiesAccess} info={info} />}
          notices={uniqueUnavailable([metricsAccess, problemsAccess], t).map((access, index) => (
            <ModuleUnavailable key={index} access={access} />
          ))}
          markers={
            <ApplicationMarkers
              metrics={metrics}
              problems={problems}
              metricsEnabled={metricsEnv !== null}
              problemsEnabled={problemsEnv !== null}
            />
          }
          // Sin acceso a Métricas no hay datos que dibujar: los marcadores ya enseñan «—».
          charts={
            metricsEnv !== null && (
              <ApplicationCharts
                applicationId={applicationId}
                metrics={metrics}
                problemList={problemsEnv !== null ? problemList : null}
              />
            )
          }
          cards={metricsEnv !== null && <ApplicationActions metrics={metrics} />}
          // Al final (0036): si falla, lo demás sigue.
          info={<ApplicationInfo access={entitiesAccess} info={info} />}
        />
      )}
    </EntityPageFrame>
  )
}
