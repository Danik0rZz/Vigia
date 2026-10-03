import { useRef, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateTime } from '@shared/format-date'
import type { TimeRangeValue } from '@shared/time-range'
import { PROBLEM_EXPORT_COLUMNS, toProblemExport, toProblemRow } from '@shared/problem-row'
import { useProblem } from '../data/modules'
import { ExportMenu } from './ExportMenu'
import { ModuleError } from './ModuleState'
import { dateLang } from '../lib/date-lang'

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
    <div data-testid={testId} className="grid gap-1">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {empty ? <p className="text-sm text-muted-foreground">{t('problems.none')}</p> : children}
    </div>
  )
}

/** Detalle de un problema: entidades, evidencias, impacto, comentarios y contexto. */
export function ProblemDetail({
  envId,
  problemId,
  timeRange
}: {
  envId: string
  problemId: string
  timeRange: TimeRangeValue
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = dateLang(i18n.language)
  const { data, error, dataUpdatedAt } = useProblem(envId, problemId)
  const sectionRef = useRef<HTMLElement>(null)
  if (error !== null) return <ModuleError error={error} />
  if (data === undefined)
    return <p className="text-sm text-muted-foreground">{t('module.loading')}</p>

  const linked = data.linkedProblem?.displayId ?? data.linkedProblem?.problemId ?? null
  return (
    <section
      ref={sectionRef}
      data-testid="problem-detail"
      className="glass grid gap-4 rounded-xl p-5"
      aria-label={t('problems.detail')}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold">{`${data.displayId} · ${data.title}`}</h2>
        <ExportMenu
          target="problem-detail"
          module="problems"
          element={sectionRef}
          table={{
            columns: PROBLEM_EXPORT_COLUMNS.map((column) => ({
              ...column,
              header: t(`problems.exportColumns.${column.key}`)
            })),
            rows: [toProblemExport(toProblemRow(data, new Date(dataUpdatedAt)))],
            timeRange,
            note: t('problems.exportNote')
          }}
        />
      </div>

      {data.rootCause !== null && (
        <p className="text-sm">
          <span className="text-muted-foreground">{`${t('problems.rootCause')}: `}</span>
          {data.rootCause.name ?? data.rootCause.id}
        </p>
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

      <Part
        testId="detail-evidence"
        title={t('problems.evidence')}
        empty={data.evidence.length === 0}
      >
        <ul className="grid gap-1 text-sm">
          {data.evidence.map((item, index) => (
            <li key={index} className="flex flex-wrap gap-x-3">
              <span>{item.name}</span>
              {item.entity !== null && <span className="text-muted-foreground">{item.entity}</span>}
              <span className="text-xs text-muted-foreground">{item.type}</span>
              {item.startTime !== null && (
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(item.startTime, lang)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Part>

      <Part testId="detail-impacts" title={t('problems.impacts')} empty={data.impacts.length === 0}>
        <ul className="grid gap-1 text-sm">
          {data.impacts.map((item, index) => (
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
      </Part>

      <Part
        testId="detail-comments"
        title={t('problems.comments')}
        empty={data.comments.length === 0}
      >
        <ul className="grid gap-2 text-sm">
          {data.comments.map((comment, index) => (
            <li key={index} className="grid gap-0.5">
              <span className="text-xs text-muted-foreground">
                {[
                  comment.author,
                  comment.createdAt === null ? null : formatDateTime(comment.createdAt, lang)
                ]
                  .filter((part) => part !== null)
                  .join(' · ')}
              </span>
              <span className="whitespace-pre-wrap">{comment.content}</span>
            </li>
          ))}
        </ul>
      </Part>

      <Part
        testId="detail-zones"
        title={t('problems.zones')}
        empty={data.managementZones.length === 0}
      >
        <p className="text-sm">{data.managementZones.join(', ')}</p>
      </Part>

      <Part testId="detail-tags" title={t('problems.tags')} empty={data.entityTags.length === 0}>
        <ul className="flex flex-wrap gap-1.5 text-xs">
          {data.entityTags.map((tag, index) => (
            <li key={`${index}-${tag}`} className="rounded bg-hover px-1.5 py-0.5">
              {tag}
            </li>
          ))}
        </ul>
      </Part>

      <Part testId="detail-linked" title={t('problems.linked')} empty={linked === null}>
        <p className="text-sm">{linked}</p>
      </Part>
    </section>
  )
}
