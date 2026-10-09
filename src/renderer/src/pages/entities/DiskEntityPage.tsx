import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { diskEntityIdSchema } from '@shared/modules'
import { ModuleUnavailable, RefreshButton } from '../../components/ModuleState'
import {
  useDiskMetrics,
  useEntityInfo,
  useEntityProblemCounts,
  useEntityProblems,
  useModuleAccess,
  useModuleRefresh,
  uniqueUnavailable
} from '../../data/modules'
import { useConnectionStatusKnown } from '../../data/tenants'
import { DiskCharts } from './DiskCharts'
import { DiskInfo } from './DiskInfo'
import { DiskMarkers } from './DiskMarkers'
import { EntityTags } from './EntityTags'
import { EntityPageFrame, EntitySections, type EntityPageProps } from './EntityPageFrame'

/**
 * Página de análisis de una entidad DISK (ficha 0040), a la que se llega desde la tabla de discos
 * del host (0019), con el modelo del host y del proceso: marcadores del rango global (uso, libre,
 * lectura, escritura, latencia o cola y problemas) y, debajo, los gráficos (uso, espacio, lectura
 * y escritura, y latencia o cola), con la franja de los problemas del disco sobre el de uso.
 * Marcadores y gráficos salen de una sola llamada a `entities:diskMetrics`. Solo pide datos con
 * «Actualizar» o con un rango nuevo (ADR-0004). Al final, la tarjeta «Información» (`entities:get`).
 */
export function DiskEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  // Un id que no es de disco no llega a main: el canal lo rechazaría igual.
  const diskId = diskEntityIdSchema.safeParse(props.id).success ? props.id : null
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
  const metrics = useDiskMetrics(metricsEnv, diskId)
  const problems = useEntityProblemCounts(problemsEnv, diskId)
  const problemList = useEntityProblems(problemsEnv, diskId)
  const info = useEntityInfo(entitiesEnv, diskId)
  const refresh = useModuleRefresh(metricsEnv ?? problemsEnv ?? entitiesEnv, 'entities')
  const canFetch =
    diskId !== null && (metricsEnv !== null || problemsEnv !== null || entitiesEnv !== null)

  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-disk"
      typeText={t('entities.types.DISK')}
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
      {diskId === null ? (
        <p className="glass rounded-xl p-5 text-sm text-muted-foreground">
          {t('entities.disk.invalidId')}
        </p>
      ) : (
        <EntitySections
          tags={<EntityTags access={entitiesAccess} info={info} />}
          notices={uniqueUnavailable([metricsAccess, problemsAccess], t).map((access, index) => (
            <ModuleUnavailable key={index} access={access} />
          ))}
          markers={
            <DiskMarkers
              metrics={metrics}
              problems={problems}
              metricsEnabled={metricsEnv !== null}
              problemsEnabled={problemsEnv !== null}
            />
          }
          // Sin acceso a Métricas no hay datos que dibujar: los marcadores ya enseñan «—».
          charts={
            metricsEnv !== null && (
              <DiskCharts
                diskId={diskId}
                metrics={metrics}
                problemList={problemsEnv !== null ? problemList : null}
              />
            )
          }
          info={<DiskInfo access={entitiesAccess} info={info} />}
        />
      )}
    </EntityPageFrame>
  )
}
