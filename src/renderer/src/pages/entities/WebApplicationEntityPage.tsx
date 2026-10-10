import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { applicationEntityIdSchema } from '@shared/modules'
import { ModuleUnavailable, RefreshButton } from '../../components/ModuleState'
import {
  useApplicationMetrics,
  useApplicationRum,
  useEntityInfo,
  useEntityProblemCounts,
  useEntityProblems,
  uniqueUnavailable
} from '../../data/modules'
import { ApplicationActions } from './ApplicationActions'
import { ApplicationApdexSection } from './ApplicationCharts'
import { ApplicationInfo } from './ApplicationInfo'
import { ApplicationMarkers } from './ApplicationMarkers'
import { ApplicationRumSections } from './ApplicationRumCharts'
import { ApplicationSection } from './ApplicationSection'
import { ApplicationUserSections } from './ApplicationUserSections'
import { useEntityPageAccess } from './entity-access'
import { EntityTags } from './EntityTags'
import { EntityPageFrame, EntitySections, type EntityPageProps } from './EntityPageFrame'

/**
 * Página de análisis de una entidad APPLICATION, una aplicación web (ficha 0034), con el modelo
 * del servicio y el orden de las fichas 0036 y 0037, con las secciones de la 0053: marcadores
 * del rango global (Apdex, usuarios activos, sesiones, acciones, errores y problemas), las
 * secciones «Actividad» y «Errores» (gráficos por tipo, de `entities:applicationRum`, 0052),
 * «Usuarios y sesiones» y «Experiencia» (Core Web Vitals, ficha 0054, del mismo canal), «Apdex» (con la franja de problemas) y «Acciones clave» (la tabla), y, al final, la tarjeta
 * «Información». El Apdex y la tabla salen de `entities:applicationMetrics` (0033). Solo pide
 * datos con «Actualizar» o con un rango nuevo (ADR-0004).
 */
export function WebApplicationEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  const {
    id: applicationId,
    metricsAccess,
    problemsAccess,
    entitiesAccess,
    metricsEnv,
    problemsEnv,
    entitiesEnv,
    refresh,
    canRefresh
  } = useEntityPageAccess(props.id, applicationEntityIdSchema)
  const metrics = useApplicationMetrics(metricsEnv, applicationId)
  const rum = useApplicationRum(metricsEnv, applicationId)
  const problems = useEntityProblemCounts(problemsEnv, applicationId)
  const problemList = useEntityProblems(problemsEnv, applicationId)
  const info = useEntityInfo(entitiesEnv, applicationId)

  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-application"
      typeText={t('entities.types.APPLICATION')}
      actions={
        canRefresh ? (
          <RefreshButton
            onRefresh={refresh}
            busy={
              metrics.isFetching ||
              rum.isFetching ||
              problems.isFetching ||
              problemList.isFetching ||
              info.isFetching
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
              rum={rum}
              problems={problems}
              metricsEnabled={metricsEnv !== null}
              problemsEnabled={problemsEnv !== null}
            />
          }
          // Sin acceso a Métricas no hay datos que dibujar: los marcadores ya enseñan «—».
          charts={
            metricsEnv !== null && (
              <>
                <ApplicationRumSections
                  applicationId={applicationId}
                  rum={rum}
                  problemList={problemsEnv !== null ? problemList : null}
                />
                <ApplicationUserSections applicationId={applicationId} rum={rum} />
                <ApplicationApdexSection
                  applicationId={applicationId}
                  metrics={metrics}
                  problemList={problemsEnv !== null ? problemList : null}
                />
              </>
            )
          }
          cards={
            metricsEnv !== null && (
              <ApplicationSection
                id="key-actions"
                title={t('entities.application.sections.keyActions')}
                columns={false}
              >
                <ApplicationActions metrics={metrics} />
              </ApplicationSection>
            )
          }
          // Al final (0036): si falla, lo demás sigue.
          info={<ApplicationInfo access={entitiesAccess} info={info} />}
        />
      )}
    </EntityPageFrame>
  )
}
