import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { formatDateTime } from '@shared/format-date'
import type { IpcOutput } from '@shared/ipc'
import type { ProblemDetail, ProblemSummary } from '@shared/modules'
import {
  INITIAL_EVIDENCE_TABLE,
  evidenceTableKey,
  useEvidenceTableStore
} from '../app/evidence-table'
import { usePageCrumb } from '../app/page-crumb'
import { useProblemClock } from '../app/problem-clock'
import { useTimeRangeValue } from '../app/time-range'
import { CommentsSection } from '../components/CommentsSection'
import { EvidenceSection } from '../components/EvidenceSection'
import { ExportMenu } from '../components/ExportMenu'
import {
  ApiWarnings,
  ModuleError,
  ModuleUnavailable,
  RefreshButton
} from '../components/ModuleState'
import { BUTTON_SECONDARY } from '../components/styles'
import { useModuleAccess, useProblem } from '../data/modules'
import { dateLang } from '../lib/date-lang'
import { IpcError } from '../lib/ipc'
import { problemWorkbook } from '../lib/problem-workbook'

/**
 * Cómo se llega desde la lista (o desde la franja de un servicio, ficha 0010): así
 * "Volver" puede ir atrás en el historial.
 */
export interface ProblemDetailLocationState {
  fromList?: boolean
}

function Part({
  testId,
  title,
  empty,
  children
}: {
  testId: string
  title: string
  /** Sin contenido: la sección no se muestra. */
  empty: boolean
  children: ReactNode
}): JSX.Element | null {
  if (empty) return null
  return (
    <section data-testid={testId} className="glass grid gap-1 rounded-xl p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

/** Sección que solo trae el detalle (problems:get): mientras llega, "Cargando…". */
function DetailPart({
  testId,
  title,
  detail,
  failed,
  empty,
  children
}: {
  testId: string
  title: string
  detail: ProblemDetail | undefined
  /** problems:get ha fallado: no hay nada que esperar. */
  failed: boolean
  empty: (detail: ProblemDetail) => boolean
  children: (detail: ProblemDetail) => ReactNode
}): JSX.Element | null {
  const { t } = useTranslation()
  if (detail === undefined) {
    return (
      <section data-testid={testId} className="glass grid gap-1 rounded-xl p-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {failed ? (
          <p className="text-sm text-muted-foreground">{t('problems.detailUnavailable')}</p>
        ) : (
          <p data-testid="detail-loading" className="text-sm text-muted-foreground">
            {t('module.loading')}
          </p>
        )}
      </section>
    )
  }
  return (
    <Part testId={testId} title={title} empty={empty(detail)}>
      {children(detail)}
    </Part>
  )
}

/**
 * La fila de la lista, si alguna lista del entorno ya la trae: se ve al
 * instante mientras llega el detalle. Si está en varias, la más reciente.
 */
function useCachedSummary(envId: string | null, problemId: string): ProblemSummary | undefined {
  const queryClient = useQueryClient()
  if (envId === null) return undefined
  let found: { summary: ProblemSummary; at: number } | undefined
  for (const query of queryClient.getQueryCache().findAll({ queryKey: [envId, 'problems'] })) {
    const data = query.state.data as Partial<IpcOutput<'problems:list'>> | undefined
    const summary = data?.problems?.find((problem) => problem.problemId === problemId)
    if (summary !== undefined && (found === undefined || query.state.dataUpdatedAt > found.at)) {
      found = { summary, at: query.state.dataUpdatedAt }
    }
  }
  return found?.summary
}

/**
 * Detalle de un problema en su propia página (/problems/:problemId). La ruta
 * lleva el problemId, nunca el displayId. Muestra al instante lo que ya trae la
 * lista y completa con problems:get.
 */
export function ProblemDetailPage(): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = dateLang(i18n.language)
  const navigate = useNavigate()
  const location = useLocation()
  const { problemId = '' } = useParams()
  const access = useModuleAccess('problems')
  const envId = access.available ? access.envId : null
  const timeRange = useTimeRangeValue()
  const {
    data: detail,
    error,
    dataUpdatedAt,
    isFetching: refreshing
  } = useProblem(envId, problemId)
  const cached = useCachedSummary(envId, problemId)
  const data: ProblemSummary | undefined = detail ?? cached
  const queryClient = useQueryClient()
  // "Ahora" de los mini gráficos de este problema: se fija la primera vez y solo
  // cambia con "Actualizar" (volver a la página no pide datos).
  const clockKey = `${envId ?? ''}/${problemId}`
  const storedNow = useProblemClock((state) => state.times[clockKey])
  const setClock = useProblemClock((state) => state.set)
  const [firstNow] = useState(() => Date.now())
  const now = storedNow ?? firstNow
  useEffect(() => {
    if (storedNow === undefined) setClock(clockKey, firstNow)
  }, [storedNow, setClock, clockKey, firstNow])
  // "Actualizar": el detalle y, si el problema sigue abierto, un "ahora" nuevo.
  // Así solo se vuelven a pedir los gráficos de evidencias activas (su rango
  // cambia); los de una evidencia ya terminada, o de un problema cerrado, no.
  const refresh = (): void => {
    if (envId === null) return
    void queryClient.refetchQueries({ queryKey: [envId, 'problems'], type: 'active' })
    if (data?.status === 'OPEN') setClock(clockKey, Date.now())
  }
  const titleRef = useRef<HTMLHeadingElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const setCrumb = usePageCrumb((state) => state.setDetail)
  const fromList = (location.state as ProblemDetailLocationState | null)?.fromList === true

  // Un problema es de un entorno: si cambia el entorno, se vuelve a su lista.
  const enteredEnv = useRef(envId)
  useEffect(() => {
    if (enteredEnv.current !== null && envId !== enteredEnv.current) {
      void navigate('/problems', { replace: true })
    }
  }, [envId, navigate])

  // El último tramo de la ruta de la barra superior, mientras se está aquí.
  const crumb = data?.displayId ?? null
  useEffect(() => {
    setCrumb(crumb)
    return () => setCrumb(null)
  }, [crumb, setCrumb])

  // Al entrar, el foco va al título: los lectores de pantalla anuncian la página.
  useEffect(() => {
    titleRef.current?.focus()
  }, [problemId])

  const back = (): void => {
    if (fromList) void navigate(-1)
    else void navigate('/problems', { replace: true })
  }

  // Exportación por secciones; las evidencias, como las deja la tabla (filtros y orden).
  const evidenceTable =
    useEvidenceTableStore((state) => state.tables[evidenceTableKey(envId ?? '', problemId)]) ??
    INITIAL_EVIDENCE_TABLE
  const workbook = useMemo(
    () =>
      detail === undefined
        ? null
        : problemWorkbook(detail, new Date(dataUpdatedAt), t, {
            filters: evidenceTable.filters,
            sort: evidenceTable.sort,
            now,
            lang: i18n.language
          }),
    [detail, dataUpdatedAt, t, evidenceTable.filters, evidenceTable.sort, now, i18n.language]
  )
  const linked = detail?.linkedProblem?.displayId ?? detail?.linkedProblem?.problemId ?? null
  // Un valor nuevo de Dynatrace se muestra tal cual.
  const translated = (group: 'severity' | 'impact', value: string): string =>
    i18n.exists(`problems.${group}.${value}`) ? t(`problems.${group}.${value}`) : value
  const notFound =
    error instanceof IpcError &&
    (error.reason?.key === 'problemNotFound' || error.code === 'NOT_FOUND')

  const backButton = (
    <button type="button" data-testid="problem-back" onClick={back} className={BUTTON_SECONDARY}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      {t('problems.back')}
    </button>
  )

  if (!access.available) {
    return (
      <div className="grid gap-4">
        <div>{backButton}</div>
        <ModuleUnavailable access={access} />
      </div>
    )
  }

  if (notFound) {
    return (
      <div data-testid="problem-not-found" role="alert" className="glass grid gap-3 rounded-xl p-5">
        <p className="text-sm">{t('errorReasons.problemNotFound')}</p>
        <Link
          to="/problems"
          replace
          data-testid="problem-not-found-back"
          className="text-sm underline underline-offset-2"
        >
          {t('problems.notFoundBack')}
        </Link>
      </div>
    )
  }

  return (
    <div ref={contentRef} data-testid="problem-page" className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {backButton}
        <span className="flex-1" />
        <RefreshButton onRefresh={refresh} busy={refreshing} />
        {workbook !== null && (
          <ExportMenu
            target="problem-page"
            module="problems"
            element={contentRef}
            workbook={{
              sheets: workbook.sheets,
              timeRange,
              loadedAt: dataUpdatedAt,
              note: t('problems.exportNote'),
              warnings: workbook.warnings
            }}
          />
        )}
      </div>

      <h1
        ref={titleRef}
        tabIndex={-1}
        data-testid="problem-page-title"
        className="text-lg font-semibold outline-none"
      >
        {data === undefined ? t('problems.detail') : `${data.displayId} · ${data.title}`}
      </h1>

      {/* Lo que ya trae la fila: se ve al instante, sin esperar al detalle. */}
      {data === undefined ? (
        error === null && (
          <p data-testid="detail-loading" className="text-sm text-muted-foreground">
            {t('module.loading')}
          </p>
        )
      ) : (
        <dl
          data-testid="detail-summary"
          className="glass grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl p-4 text-sm"
        >
          <dt className="text-muted-foreground">{t('problems.columns.status')}</dt>
          <dd>{t(`problems.status.${data.status}`)}</dd>
          <dt className="text-muted-foreground">{t('problems.columns.severity')}</dt>
          <dd>{translated('severity', data.severityLevel)}</dd>
          <dt className="text-muted-foreground">{t('problems.columns.impact')}</dt>
          <dd>{translated('impact', data.impactLevel)}</dd>
          <dt className="text-muted-foreground">{t('problems.columns.start')}</dt>
          <dd className="tabular-nums">{formatDateTime(data.startTime, lang)}</dd>
          <dt className="text-muted-foreground">{t('problems.columns.end')}</dt>
          <dd className="tabular-nums">
            {data.endTime === null ? t('problems.ongoing') : formatDateTime(data.endTime, lang)}
          </dd>
        </dl>
      )}

      {error !== null && <ModuleError error={error} />}
      <ApiWarnings invalid={detail?.invalid} />

      {data !== undefined && (
        <>
          {data.rootCause !== null && (
            <Part testId="detail-root-cause" title={t('problems.rootCause')} empty={false}>
              <p className="text-sm">{data.rootCause.name ?? data.rootCause.id}</p>
            </Part>
          )}

          <Part
            testId="detail-affected"
            title={t('problems.affectedEntities')}
            empty={data.affectedEntities.length === 0}
          >
            <ul className="grid gap-1 text-sm">
              {data.affectedEntities.map((entity) => (
                <li key={entity.id} data-testid="problem-entity" className="flex flex-wrap gap-x-3">
                  <span>{entity.name ?? entity.id}</span>
                  <span data-testid="entity-type" className="text-muted-foreground">
                    {`${t('problems.entityType')}: ${entity.type}`}
                  </span>
                  <span data-testid="entity-id" className="font-mono text-xs text-muted-foreground">
                    {`${t('problems.entityId')}: ${entity.id}`}
                  </span>
                </li>
              ))}
            </ul>
          </Part>

          <Part
            testId="detail-cluster"
            title={t('problems.clusterSection')}
            empty={data.clusters.length === 0 && data.namespaces.length === 0}
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {data.clusters.length > 0 && (
                <>
                  <dt className="text-muted-foreground">{t('problems.clusterLabel')}</dt>
                  <dd>{data.clusters.join(', ')}</dd>
                </>
              )}
              {data.namespaces.length > 0 && (
                <>
                  <dt className="text-muted-foreground">{t('problems.namespaceLabel')}</dt>
                  <dd>{data.namespaces.join(', ')}</dd>
                </>
              )}
            </dl>
          </Part>

          <Part
            testId="detail-impacted"
            title={t('problems.impactedEntities')}
            empty={data.impactedEntities.length === 0}
          >
            <p className="text-sm">
              {data.impactedEntities.map((entity) => entity.name ?? entity.id).join(', ')}
            </p>
          </Part>

          <DetailPart
            testId="detail-evidence"
            title={t('problems.evidence')}
            detail={detail}
            failed={error !== null}
            empty={(d) => d.evidence.length === 0}
          >
            {(d) => <EvidenceSection envId={envId ?? ''} detail={d} now={now} />}
          </DetailPart>

          <DetailPart
            testId="detail-comments"
            title={t('problems.comments')}
            detail={detail}
            failed={error !== null}
            empty={(d) => d.comments.length === 0}
          >
            {(d) => <CommentsSection envId={envId ?? ''} detail={d} />}
          </DetailPart>

          <Part
            testId="detail-zones"
            title={t('problems.zones')}
            empty={data.managementZones.length === 0}
          >
            <p className="text-sm">{data.managementZones.join(', ')}</p>
          </Part>

          <DetailPart
            testId="detail-tags"
            title={t('problems.tags')}
            detail={detail}
            failed={error !== null}
            empty={(d) => d.entityTags.length === 0}
          >
            {(d) => (
              <ul className="flex flex-wrap gap-1.5 text-xs">
                {d.entityTags.map((tag, index) => (
                  <li key={`${index}-${tag}`} className="rounded bg-hover px-1.5 py-0.5">
                    {tag}
                  </li>
                ))}
              </ul>
            )}
          </DetailPart>

          <DetailPart
            testId="detail-linked"
            title={t('problems.linked')}
            detail={detail}
            failed={error !== null}
            empty={() => linked === null}
          >
            {() => <p className="text-sm">{linked}</p>}
          </DetailPart>
        </>
      )}
    </div>
  )
}
