import { useEffect, useRef, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { formatDateTime } from '@shared/format-date'
import type { IpcOutput } from '@shared/ipc'
import type { ProblemDetail, ProblemSummary } from '@shared/modules'
import { PROBLEM_EXPORT_COLUMNS, toProblemExport, toProblemRow } from '@shared/problem-row'
import { usePageCrumb } from '../app/page-crumb'
import { useTimeRangeValue } from '../app/time-range'
import { ExportMenu } from '../components/ExportMenu'
import { ModuleError, ModuleUnavailable } from '../components/ModuleState'
import { BUTTON_SECONDARY } from '../components/styles'
import { useModuleAccess, useProblem } from '../data/modules'
import { dateLang } from '../lib/date-lang'
import { IpcError } from '../lib/ipc'

/** Cómo se llega desde la lista: así "Volver" puede ir atrás en el historial. */
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
  /** Sin contenido: se dice "Ninguno" en vez de dejar la sección vacía. */
  empty: boolean
  children: ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <section data-testid={testId} className="glass grid gap-1 rounded-xl p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {empty ? <p className="text-sm text-muted-foreground">{t('problems.none')}</p> : children}
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
}): JSX.Element {
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
  const { data: detail, error, dataUpdatedAt } = useProblem(envId, problemId)
  const cached = useCachedSummary(envId, problemId)
  const data: ProblemSummary | undefined = detail ?? cached
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
        {detail !== undefined && (
          <ExportMenu
            target="problem-page"
            module="problems"
            element={contentRef}
            table={{
              columns: PROBLEM_EXPORT_COLUMNS.map((column) => ({
                ...column,
                header: t(`problems.exportColumns.${column.key}`)
              })),
              rows: [toProblemExport(toProblemRow(detail, new Date(dataUpdatedAt)))],
              timeRange,
              loadedAt: dataUpdatedAt,
              note: t('problems.exportNote')
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
            {(d) => (
              <ul className="grid gap-1 text-sm">
                {d.evidence.map((item, index) => (
                  <li key={index} className="flex flex-wrap gap-x-3">
                    <span>{item.name}</span>
                    {item.entity !== null && (
                      <span className="text-muted-foreground">{item.entity}</span>
                    )}
                    <span className="text-xs text-muted-foreground">{item.type}</span>
                    {item.startTime !== null && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatDateTime(item.startTime, lang)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </DetailPart>

          <DetailPart
            testId="detail-impacts"
            title={t('problems.impacts')}
            detail={detail}
            failed={error !== null}
            empty={(d) => d.impacts.length === 0}
          >
            {(d) => (
              <ul className="grid gap-1 text-sm">
                {d.impacts.map((item, index) => (
                  <li key={index} className="flex flex-wrap gap-x-3">
                    <span>{item.entity ?? item.type}</span>
                    {item.estimatedAffectedUsers !== null && (
                      <span className="text-muted-foreground">
                        {t('problems.affectedUsers', { count: item.estimatedAffectedUsers })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </DetailPart>

          <DetailPart
            testId="detail-comments"
            title={t('problems.comments')}
            detail={detail}
            failed={error !== null}
            empty={(d) => d.comments.length === 0}
          >
            {(d) => (
              <ul className="grid gap-2 text-sm">
                {d.comments.map((comment, index) => (
                  <li key={index} className="grid gap-0.5">
                    <span className="text-xs text-muted-foreground">
                      {[
                        comment.author,
                        comment.createdAt === null ? null : formatDateTime(comment.createdAt, lang)
                      ]
                        .filter((part) => part !== null)
                        .join(' · ')}
                    </span>
                    {/* Siempre como texto: un comentario nunca se interpreta como HTML. */}
                    <span className="whitespace-pre-wrap">{comment.content}</span>
                  </li>
                ))}
              </ul>
            )}
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
