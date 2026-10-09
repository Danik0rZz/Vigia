import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { hostEntityIdSchema } from '@shared/modules'
import { ModuleUnavailable, RefreshButton } from '../../components/ModuleState'
import {
  useEntityInfo,
  useEntityProblemCounts,
  useEntityProblems,
  useHostBreakdown,
  useHostLogs,
  useHostMetrics,
  useModuleAccess,
  useModuleRefresh,
  uniqueUnavailable
} from '../../data/modules'
import { useConnectionStatusKnown } from '../../data/tenants'
import { EntityTags } from './EntityTags'
import { EntityPageFrame, EntitySections, type EntityPageProps } from './EntityPageFrame'
import { HostCharts } from './HostCharts'
import { HostInfo } from './HostInfo'
import { HostLogs } from './HostLogs'
import { HostMarkers } from './HostMarkers'
import { HostTables } from './HostTables'

/**
 * Página de análisis de una entidad HOST (ficha 0018), con el modelo del servicio: marcadores
 * del rango global (CPU, memoria, red, disco y problemas) y, debajo, los cuatro gráficos, con la
 * franja de los problemas del host sobre el de la CPU; debajo, las tablas de discos y procesos
 * (ficha 0019, canal `entities:hostBreakdown`). Marcadores y gráficos salen de una sola
 * llamada a `entities:hostMetrics` (ficha 0016). Solo pide datos con «Actualizar» o con un rango
 * nuevo (ADR-0004). Al final, la tarjeta «Información» (ficha 0020, canal `entities:get`), como
 * en todas las páginas de entidad (`EntitySections`, ficha 0036); justo antes, la tarjeta «Logs»
 * (ficha 0041, canal `entities:hostLogs`).
 */
export function HostEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  // Un id que no es de host no llega a main: el canal lo rechazaría igual.
  const hostId = hostEntityIdSchema.safeParse(props.id).success ? props.id : null
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
  const metrics = useHostMetrics(metricsEnv, hostId)
  const breakdown = useHostBreakdown(metricsEnv, hostId)
  const problems = useEntityProblemCounts(problemsEnv, hostId)
  const problemList = useEntityProblems(problemsEnv, hostId)
  const info = useEntityInfo(entitiesEnv, hostId)
  const logs = useHostLogs(entitiesEnv, hostId)
  const refresh = useModuleRefresh(metricsEnv ?? problemsEnv ?? entitiesEnv, 'entities')
  const canFetch =
    hostId !== null && (metricsEnv !== null || problemsEnv !== null || entitiesEnv !== null)

  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-host"
      typeText={t('entities.types.HOST')}
      actions={
        canFetch ? (
          <RefreshButton
            onRefresh={refresh}
            busy={
              metrics.isFetching ||
              breakdown.isFetching ||
              problems.isFetching ||
              problemList.isFetching ||
              info.isFetching ||
              logs.isFetching
            }
          />
        ) : undefined
      }
    >
      {hostId === null ? (
        <p className="glass rounded-xl p-5 text-sm text-muted-foreground">
          {t('entities.host.invalidId')}
        </p>
      ) : (
        <EntitySections
          tags={<EntityTags access={entitiesAccess} info={info} />}
          notices={uniqueUnavailable([metricsAccess, problemsAccess], t).map((access, index) => (
            <ModuleUnavailable key={index} access={access} />
          ))}
          markers={
            <HostMarkers
              metrics={metrics}
              problems={problems}
              metricsEnabled={metricsEnv !== null}
              problemsEnabled={problemsEnv !== null}
            />
          }
          // Sin acceso a Métricas no hay datos que dibujar: los marcadores ya enseñan «—».
          charts={
            metricsEnv !== null && (
              <HostCharts
                hostId={hostId}
                metrics={metrics}
                problemList={problemsEnv !== null ? problemList : null}
              />
            )
          }
          cards={
            <>
              {metricsEnv !== null && <HostTables breakdown={breakdown} />}
              {/* Ficha 0041: con entities.read, aunque falten las métricas. */}
              <HostLogs access={entitiesAccess} logs={logs} />
            </>
          }
          // Ficha 0020 (al final desde la 0036): si falla, lo demás sigue.
          info={<HostInfo access={entitiesAccess} info={info} />}
        />
      )}
    </EntityPageFrame>
  )
}
