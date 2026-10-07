import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { serviceEntityIdSchema } from '@shared/modules'
import { ModuleUnavailable, RefreshButton } from '../../components/ModuleState'
import {
  useEntityProblemCounts,
  useModuleAccess,
  useModuleRefresh,
  useServiceMetrics,
  type ModuleAccess,
  unavailableReason
} from '../../data/modules'
import { EntityPageFrame, type EntityPageProps } from './EntityPageFrame'
import { ServiceCharts } from './ServiceCharts'
import { ServiceMarkers } from './ServiceMarkers'

/**
 * Página de análisis de una entidad SERVICE: marcadores del rango global
 * (ficha 0008) y, debajo, los cuatro gráficos de peticiones (ficha 0009). Solo
 * pide datos con «Actualizar» o con un rango nuevo (ADR-0004).
 */
export function ServiceEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  // Un id que no es de servicio no llega a main: el canal lo rechazaría igual.
  const serviceId = serviceEntityIdSchema.safeParse(props.id).success ? props.id : null
  const metricsAccess = useModuleAccess('metrics')
  const problemsAccess = useModuleAccess('problems')
  const metricsEnv = metricsAccess.available ? metricsAccess.envId : null
  const problemsEnv = problemsAccess.available ? problemsAccess.envId : null
  const metrics = useServiceMetrics(metricsEnv, serviceId)
  const problems = useEntityProblemCounts(problemsEnv, serviceId)
  const refresh = useModuleRefresh(metricsEnv ?? problemsEnv, 'entities')
  const canFetch = serviceId !== null && (metricsEnv !== null || problemsEnv !== null)

  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-service"
      typeText={t('entities.types.SERVICE')}
      actions={
        canFetch ? (
          <RefreshButton onRefresh={refresh} busy={metrics.isFetching || problems.isFetching} />
        ) : undefined
      }
    >
      {serviceId === null ? (
        <p className="glass rounded-xl p-5 text-sm text-muted-foreground">
          {t('entities.service.invalidId')}
        </p>
      ) : (
        <>
          {uniqueUnavailable([metricsAccess, problemsAccess], t).map((access, index) => (
            <ModuleUnavailable key={index} access={access} />
          ))}
          <ServiceMarkers
            metrics={metrics}
            problems={problems}
            metricsEnabled={metricsEnv !== null}
            problemsEnabled={problemsEnv !== null}
          />
          {/* Sin acceso a Métricas no hay datos que dibujar: los marcadores ya enseñan «—». */}
          {metricsEnv !== null && <ServiceCharts serviceId={serviceId} metrics={metrics} />}
        </>
      )}
    </EntityPageFrame>
  )
}

/** Los motivos de no disponible, sin repetir el mismo texto (por ejemplo, sin entorno). */
function uniqueUnavailable(
  accesses: ModuleAccess[],
  t: (key: string, params?: Record<string, string>) => string
): Exclude<ModuleAccess, { available: true }>[] {
  const seen = new Set<string>()
  const result: Exclude<ModuleAccess, { available: true }>[] = []
  for (const access of accesses) {
    if (access.available) continue
    const reason = unavailableReason(access)
    const text = t(reason.key, reason.params)
    if (seen.has(text)) continue
    seen.add(text)
    result.push(access)
  }
  return result
}
