import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { ZodType } from 'zod'
import { monitorEntityIdSchema, type MonitorKind } from '@shared/modules'
import { ModuleUnavailable, RefreshButton } from '../../components/ModuleState'
import {
  useEntityInfo,
  useEntityProblemCounts,
  useEntityProblems,
  useMonitorBreakdown,
  useMonitorMetrics,
  uniqueUnavailable
} from '../../data/modules'
import { useEntityPageAccess } from './entity-access'
import { EntityTags } from './EntityTags'
import { EntityPageFrame, EntitySections, type EntityPageProps } from './EntityPageFrame'
import { MonitorCharts } from './MonitorCharts'
import { MonitorInfo } from './MonitorInfo'
import { MonitorMarkers } from './MonitorMarkers'
import { MonitorTables } from './MonitorTables'

/** Prefijo del id de cada tipo de monitor: el de la otra página no se pide aquí. */
const ID_PREFIX: Record<MonitorKind, string> = {
  browser: 'SYNTHETIC_TEST-',
  http: 'HTTP_CHECK-'
}

/** Esquema del id de cada tipo de monitor: el de monitor, y solo con el prefijo de este tipo. */
const ID_SCHEMA: Record<MonitorKind, ZodType<string>> = {
  browser: monitorEntityIdSchema.refine((id) => id.startsWith(ID_PREFIX.browser)),
  http: monitorEntityIdSchema.refine((id) => id.startsWith(ID_PREFIX.http))
}

/**
 * Cuerpo común de las páginas de browser monitor (SYNTHETIC_TEST) y HTTP monitor (HTTP_CHECK),
 * ficha 0024, con el modelo del servicio y del host: marcadores del rango global
 * (disponibilidad, duración, ejecuciones, localizaciones y problemas) y, debajo, los gráficos,
 * con la franja de los problemas del monitor sobre el de la disponibilidad. Marcadores y gráficos
 * salen de una sola llamada a `entities:monitorMetrics` (ficha 0022); las localizaciones, de
 * `entities:monitorBreakdown` (0023). Solo pide datos con «Actualizar» o con un rango nuevo
 * (ADR-0004). Debajo de los gráficos, las tablas de localizaciones y de pasos o peticiones
 * (0025), con el mismo desglose que el marcador. Al final, la tarjeta «Información» (0026, canal
 * `entities:get`), como en todas las páginas de entidad (`EntitySections`, ficha 0036).
 */
export function MonitorEntityPage({
  monitorKind,
  testId,
  ...props
}: EntityPageProps & { monitorKind: MonitorKind; testId: string }): JSX.Element {
  const { t } = useTranslation()
  // Un id que no es de este tipo de monitor no llega a main: el canal lo rechazaría igual.
  const {
    id: monitorId,
    metricsAccess,
    problemsAccess,
    entitiesAccess,
    metricsEnv,
    problemsEnv,
    entitiesEnv,
    refresh,
    canRefresh
  } = useEntityPageAccess(props.id, ID_SCHEMA[monitorKind])
  const metrics = useMonitorMetrics(metricsEnv, monitorId)
  const breakdown = useMonitorBreakdown(metricsEnv, monitorId)
  const problems = useEntityProblemCounts(problemsEnv, monitorId)
  const problemList = useEntityProblems(problemsEnv, monitorId)
  const info = useEntityInfo(entitiesEnv, monitorId)

  return (
    <EntityPageFrame
      {...props}
      testId={testId}
      typeText={t(`entities.types.${monitorKind === 'browser' ? 'SYNTHETIC_TEST' : 'HTTP_CHECK'}`)}
      actions={
        canRefresh ? (
          <RefreshButton
            onRefresh={refresh}
            busy={
              metrics.isFetching ||
              breakdown.isFetching ||
              problems.isFetching ||
              problemList.isFetching ||
              info.isFetching
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
        <EntitySections
          tags={<EntityTags access={entitiesAccess} info={info} />}
          notices={uniqueUnavailable([metricsAccess, problemsAccess], t).map((access, index) => (
            <ModuleUnavailable key={index} access={access} />
          ))}
          markers={
            <MonitorMarkers
              monitorKind={monitorKind}
              metrics={metrics}
              breakdown={breakdown}
              problems={problems}
              metricsEnabled={metricsEnv !== null}
              problemsEnabled={problemsEnv !== null}
            />
          }
          // Sin acceso a Métricas no hay datos que dibujar: los marcadores ya enseñan «—».
          charts={
            metricsEnv !== null && (
              <MonitorCharts
                monitorKind={monitorKind}
                monitorId={monitorId}
                metrics={metrics}
                problemList={problemsEnv !== null ? problemList : null}
              />
            )
          }
          cards={
            metricsEnv !== null && <MonitorTables monitorKind={monitorKind} breakdown={breakdown} />
          }
          // Ficha 0026 (al final desde la 0036): si falla, lo demás sigue.
          info={<MonitorInfo access={entitiesAccess} info={info} />}
        />
      )}
    </EntityPageFrame>
  )
}
