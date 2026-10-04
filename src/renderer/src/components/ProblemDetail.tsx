import { useRef, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { formatDateTime } from '@shared/format-date'
import type { ProblemDetail as ProblemDetailData, ProblemSummary } from '@shared/modules'
import type { TimeRangeValue } from '@shared/time-range'
import { PROBLEM_EXPORT_COLUMNS, toProblemExport, toProblemRow } from '@shared/problem-row'
import { useProblem } from '../data/modules'
import { dateLang } from '../lib/date-lang'
import { ExportMenu } from './ExportMenu'
import { ModuleError } from './ModuleState'
import { BUTTON_ICON } from './styles'

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
  detail: ProblemDetailData | undefined
  /** problems:get ha fallado: no hay nada que esperar. */
  failed: boolean
  empty: (detail: ProblemDetailData) => boolean
  children: (detail: ProblemDetailData) => ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  if (detail === undefined) {
    return (
      <div data-testid={testId} className="grid gap-1">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        {failed ? (
          <p className="text-sm text-muted-foreground">{t('problems.detailUnavailable')}</p>
        ) : (
          <p data-testid="detail-loading" className="text-sm text-muted-foreground">
            {t('module.loading')}
          </p>
        )}
      </div>
    )
  }
  return (
    <Part testId={testId} title={title} empty={empty(detail)}>
      {children(detail)}
    </Part>
  )
}

/**
 * Detalle de un problema en un panel lateral (diálogo con foco y cierre).
 * Muestra al instante lo que ya trae la fila y completa con problems:get
 * (evidencias, impacto, comentarios, etiquetas y problema vinculado).
 */
export function ProblemDetail({
  envId,
  summary,
  timeRange,
  onClose
}: {
  envId: string
  /** La fila de la lista: se ve mientras llega el detalle. */
  summary: ProblemSummary
  timeRange: TimeRangeValue
  /** Al cerrar, Radix devuelve el foco al elemento que abrió el panel. */
  onClose: () => void
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = dateLang(i18n.language)
  const { data: detail, error, dataUpdatedAt } = useProblem(envId, summary.problemId)
  const contentRef = useRef<HTMLDivElement>(null)
  const data: ProblemSummary = detail ?? summary
  const linked = detail?.linkedProblem?.displayId ?? detail?.linkedProblem?.problemId ?? null
  // Un valor nuevo de Dynatrace se muestra tal cual.
  const translated = (group: 'severity' | 'impact', value: string): string =>
    i18n.exists(`problems.${group}.${value}`) ? t(`problems.${group}.${value}`) : value

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content
          ref={contentRef}
          data-testid="problem-detail"
          aria-label={t('problems.detail')}
          aria-describedby={undefined}
          className="glass fixed top-0 right-0 z-50 grid h-full w-[min(560px,90vw)] content-start gap-4 overflow-y-auto p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-semibold">
              {`${data.displayId} · ${data.title}`}
            </Dialog.Title>
            <div className="flex items-center gap-1">
              {detail !== undefined && (
                <ExportMenu
                  target="problem-detail"
                  module="problems"
                  element={contentRef}
                  table={{
                    columns: PROBLEM_EXPORT_COLUMNS.map((column) => ({
                      ...column,
                      header: t(`problems.exportColumns.${column.key}`)
                    })),
                    rows: [toProblemExport(toProblemRow(detail, new Date(dataUpdatedAt)))],
                    timeRange,
                    note: t('problems.exportNote')
                  }}
                />
              )}
              <Dialog.Close
                data-testid="problem-detail-close"
                aria-label={t('problems.close')}
                title={t('problems.close')}
                className={BUTTON_ICON}
              >
                <X aria-hidden="true" className="size-4" />
              </Dialog.Close>
            </div>
          </div>
          {/* Lo que ya trae la fila: se ve al instante, sin esperar al detalle. */}
          <dl
            data-testid="detail-summary"
            className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm"
          >
            <dt className="text-muted-foreground">{t('problems.columns.status')}</dt>
            <dd>{t(`problems.status.${data.status}`)}</dd>
            <dt className="text-muted-foreground">{t('problems.columns.severity')}</dt>
            <dd>{translated('severity', data.severityLevel)}</dd>
            <dt className="text-muted-foreground">{t('problems.columns.impact')}</dt>
            <dd>{translated('impact', data.impactLevel)}</dd>
            <dt className="text-muted-foreground">{t('problems.columns.start')}</dt>
            <dd>{formatDateTime(data.startTime, lang)}</dd>
            <dt className="text-muted-foreground">{t('problems.columns.end')}</dt>
            <dd>
              {data.endTime === null ? t('problems.ongoing') : formatDateTime(data.endTime, lang)}
            </dd>
          </dl>

          {error !== null && <ModuleError error={error} />}

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
                      <span className="text-xs text-muted-foreground">
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
