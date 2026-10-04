import type { TFunction } from 'i18next'
import { MAX_EXPORT_ROWS, type ExportColumn, type ProblemDetail } from '@shared/modules'
import {
  evidenceDuration,
  filterEvidence,
  sortEvidence,
  toEvidenceView,
  type EvidenceFilters,
  type EvidenceSort,
  type EvidenceView
} from '@shared/problem-evidence'
import { PROBLEM_EXPORT_COLUMNS, toProblemExport, toProblemRow } from '@shared/problem-row'
import type { ExportWorkbook } from '../components/ExportMenu'

type Sheet = ExportWorkbook['sheets'][number]

const MINUTE_MS = 60_000

/** Lo que la tabla de evidencias tiene puesto: se exporta lo mismo que se ve. */
export interface EvidenceTableExport {
  filters: EvidenceFilters
  sort: EvidenceSort
  /** "Ahora" del problema: la duración de lo que sigue activo. */
  now: number
  lang: string
}

/** Los filtros activos de la tabla, para leerlos en la hoja Info. */
function activeFilters(
  filters: EvidenceFilters,
  views: readonly EvidenceView[],
  t: TFunction
): string[] {
  const parts: string[] = []
  if (filters.status !== 'ALL') {
    parts.push(
      `${t('problems.eventTable.columns.status')}: ${t(
        filters.status === 'OPEN'
          ? 'problems.eventTable.statusOpen'
          : 'problems.eventTable.statusClosed'
      )}`
    )
  }
  if (filters.text.trim() !== '') {
    parts.push(`${t('problems.eventTable.textFilter')}: "${filters.text.trim()}"`)
  }
  if (filters.types.length > 0) {
    parts.push(`${t('problems.eventTable.types')}: ${filters.types.join(', ')}`)
  }
  if (filters.entity !== null) {
    const entity = views.find((view) => view.entity?.id === filters.entity)?.entity
    parts.push(`${t('problems.eventTable.entityFilter')}: ${entity?.label ?? filters.entity}`)
  }
  if (filters.tag !== null) parts.push(`${t('problems.eventTable.tagFilter')}: ${filters.tag}`)
  if (filters.rootCauseOnly) parts.push(t('problems.eventTable.rootOnly'))
  return parts
}

/**
 * Hojas de la exportación del detalle de un problema: Resumen, Entidades y
 * Evidencias (principales: van también en CSV y TXT) y Comentarios. Una hoja
 * no principal sin filas no se envía. Las evidencias son las que muestra la
 * tabla, con sus filtros y en su orden (la hoja Info lo dice), recortadas si
 * pasan del límite global de filas.
 */
export function problemWorkbook(
  detail: ProblemDetail,
  loadedAt: Date,
  t: TFunction,
  table: EvidenceTableExport
): { sheets: Sheet[]; warnings: string[] } {
  const column = (
    key: string,
    header: string,
    type: ExportColumn['type'] = 'string'
  ): ExportColumn => ({
    key,
    header: t(header),
    type
  })

  const summary: Sheet = {
    name: t('problems.sheets.summary'),
    primary: true,
    columns: PROBLEM_EXPORT_COLUMNS.map((item) => ({
      ...item,
      header: t(`problems.exportColumns.${item.key}`)
    })),
    rows: [toProblemExport(toProblemRow(detail, loadedAt))]
  }

  const entities: Sheet = {
    name: t('problems.sheets.entities'),
    primary: true,
    columns: [
      column('role', 'problems.entityColumns.role'),
      column('name', 'problems.entityColumns.name'),
      column('type', 'problems.entityColumns.type'),
      column('id', 'problems.entityColumns.id')
    ],
    rows: [
      ...detail.affectedEntities.map((entity) => ({
        role: t('problems.entityRole.affected'),
        name: entity.name,
        type: entity.type,
        id: entity.id
      })),
      ...detail.impactedEntities.map((entity) => ({
        role: t('problems.entityRole.impacted'),
        name: entity.name,
        type: entity.type,
        id: entity.id
      }))
    ]
  }

  const comments: Sheet = {
    name: t('problems.sheets.comments'),
    primary: false,
    columns: [
      column('author', 'problems.commentColumns.author'),
      column('date', 'problems.commentColumns.date', 'date'),
      column('context', 'problems.commentColumns.context'),
      column('content', 'problems.commentColumns.content')
    ],
    rows: detail.comments.map((comment) => ({
      author: comment.author,
      date: comment.createdAt,
      context: comment.context,
      content: comment.content
    }))
  }

  // Lo que la API no ha mandado (totalCount mayor que lo recibido) se dice en Info.
  const warnings: string[] = []
  // Se compara con lo que mandó la API (también lo ilegible, que va aparte como invalid).
  if (detail.evidenceTotal !== null && detail.evidenceTotal > detail.evidenceReceived) {
    warnings.push(
      t('problems.apiTruncatedEvidence', {
        shown: detail.evidenceReceived,
        total: detail.evidenceTotal
      })
    )
  }
  if (detail.commentTotal !== null && detail.commentTotal > detail.commentReceived) {
    warnings.push(
      t('problems.apiTruncatedComments', {
        shown: detail.commentReceived,
        total: detail.commentTotal
      })
    )
  }

  // Las evidencias son las de la tabla: con sus filtros y en su orden.
  const views = detail.evidence.map((item, index) => toEvidenceView(item, index))
  const shown = sortEvidence(
    filterEvidence(views, table.filters),
    table.sort,
    table.lang,
    table.now
  )
  const active = activeFilters(table.filters, views, t)
  warnings.push(
    active.length === 0
      ? t('problems.evidenceExportAll', { total: views.length })
      : t('problems.evidenceExportFiltered', {
          shown: shown.length,
          total: views.length,
          filters: active.join('; ')
        })
  )
  // Con lo que queda del límite global después de las demás hojas.
  const others = [summary, entities, comments].reduce(
    (total, sheet) => total + sheet.rows.length,
    0
  )
  const room = Math.max(0, MAX_EXPORT_ROWS - others)
  const kept = shown.slice(0, room)
  if (kept.length < shown.length) {
    warnings.push(t('problems.evidenceTruncated', { shown: kept.length, total: shown.length }))
  }
  const yesNo = (value: boolean): string => t(value ? 'problems.yes' : 'problems.no')
  const evidence: Sheet = {
    name: t('problems.sheets.evidence'),
    primary: true,
    columns: [
      column('status', 'problems.evidenceColumns.status'),
      column('title', 'problems.evidenceColumns.title'),
      column('type', 'problems.evidenceColumns.type'),
      column('entity', 'problems.evidenceColumns.entity'),
      column('entityType', 'problems.evidenceColumns.entityType'),
      column('start', 'problems.evidenceColumns.start', 'date'),
      // Una fecha o "Activo": la columna es de fecha y el texto se guarda como texto.
      column('end', 'problems.evidenceColumns.end', 'date'),
      column('durationMinutes', 'problems.evidenceColumns.durationMinutes', 'number'),
      column('tags', 'problems.evidenceColumns.tags'),
      column('rootCause', 'problems.evidenceColumns.rootCause'),
      column('maintenance', 'problems.evidenceColumns.maintenance'),
      column('frequent', 'problems.evidenceColumns.frequent'),
      column('eventId', 'problems.evidenceColumns.eventId'),
      column('before', 'problems.evidenceColumns.before', 'number'),
      column('after', 'problems.evidenceColumns.after', 'number'),
      column('unit', 'problems.evidenceColumns.unit'),
      column('metricId', 'problems.evidenceColumns.metricId')
    ],
    rows: kept.map((item) => {
      const duration = evidenceDuration(item, table.now)
      return {
        status: t(`problems.status.${item.status}`),
        title: item.title,
        type: t(
          `${item.type === 'EVENT' ? 'problems.eventTypes' : 'problems.evidenceTypes'}.${item.typeLabel}`,
          { defaultValue: item.typeLabel }
        ),
        entity: item.entity?.label ?? null,
        entityType: item.entity?.type ?? null,
        start: item.start,
        end: item.end === 'ACTIVE' ? t('problems.eventTable.active') : item.end,
        durationMinutes: duration === null ? null : Math.round(duration / MINUTE_MS),
        tags: item.tags.length === 0 ? null : item.tags.join(' | '),
        rootCause: yesNo(item.rootCause),
        maintenance: yesNo(item.flags.maintenance),
        frequent: yesNo(item.flags.frequent),
        eventId: item.eventId,
        before: item.before,
        after: item.after,
        unit: item.unit,
        metricId: item.metricId
      }
    })
  }

  return {
    sheets: [summary, entities, evidence, comments].filter(
      (sheet) => sheet.primary || sheet.rows.length > 0
    ),
    warnings
  }
}
