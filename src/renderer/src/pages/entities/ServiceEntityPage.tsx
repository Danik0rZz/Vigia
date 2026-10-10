import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { serviceEntityIdSchema } from '@shared/modules'
import { ModuleUnavailable, RefreshButton } from '../../components/ModuleState'
import {
  useEntityProblemCounts,
  useEntityInfo,
  useEntityProblems,
  useServiceMetrics,
  uniqueUnavailable
} from '../../data/modules'
import { useEntityPageAccess } from './entity-access'
import { EntityTags } from './EntityTags'
import { EntityPageFrame, EntitySections, type EntityPageProps } from './EntityPageFrame'
import { ServiceCharts } from './ServiceCharts'
import { ServiceInfo } from './ServiceInfo'
import { ServiceMarkers } from './ServiceMarkers'
import { serviceTypeName } from './service-type'

/**
 * Página de análisis de una entidad SERVICE: marcadores del rango global
 * (ficha 0008) y, debajo, los cuatro gráficos de peticiones (ficha 0009), con la
 * franja de los problemas de la entidad sobre la tasa de error (ficha 0010). Solo
 * pide datos con «Actualizar» o con un rango nuevo (ADR-0004). La tarjeta «Información»
 * (ficha 0015) va al final, como en todas las páginas de entidad (`EntitySections`, ficha 0036).
 */
export function ServiceEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  const {
    id: serviceId,
    metricsAccess,
    problemsAccess,
    entitiesAccess,
    metricsEnv,
    problemsEnv,
    entitiesEnv,
    refresh,
    canRefresh
  } = useEntityPageAccess(props.id, serviceEntityIdSchema)
  const metrics = useServiceMetrics(metricsEnv, serviceId)
  const problems = useEntityProblemCounts(problemsEnv, serviceId)
  const problemList = useEntityProblems(problemsEnv, serviceId)
  const info = useEntityInfo(entitiesEnv, serviceId)
  // Ficha 0047: el serviceType que usó main para las métricas, junto al tipo de entidad.
  const serviceType = metrics.data?.serviceType ?? null
  const typeText =
    serviceType === null
      ? t('entities.types.SERVICE')
      : `${t('entities.types.SERVICE')} · ${serviceTypeName(serviceType, t)}`

  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-service"
      typeText={typeText}
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
      {serviceId === null ? (
        <p className="glass rounded-xl p-5 text-sm text-muted-foreground">
          {t('entities.service.invalidId')}
        </p>
      ) : (
        <EntitySections
          tags={<EntityTags access={entitiesAccess} info={info} />}
          notices={uniqueUnavailable([metricsAccess, problemsAccess], t).map((access, index) => (
            <ModuleUnavailable key={index} access={access} />
          ))}
          markers={
            <ServiceMarkers
              metrics={metrics}
              problems={problems}
              metricsEnabled={metricsEnv !== null}
              problemsEnabled={problemsEnv !== null}
            />
          }
          // Sin acceso a Métricas no hay datos que dibujar: los marcadores ya enseñan «—».
          charts={
            metricsEnv !== null && (
              <ServiceCharts
                serviceId={serviceId}
                metrics={metrics}
                problemList={problemsEnv !== null ? problemList : null}
              />
            )
          }
          // Ficha 0015 (al final desde la 0036): si falla, lo demás sigue.
          info={<ServiceInfo access={entitiesAccess} info={info} />}
        />
      )}
    </EntityPageFrame>
  )
}
