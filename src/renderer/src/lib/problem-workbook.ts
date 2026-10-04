import type { TFunction } from 'i18next'
import { MAX_EXPORT_ROWS, type ExportColumn, type ProblemDetail } from '@shared/modules'
import { toEvidenceView } from '@shared/problem-evidence'
import { PROBLEM_EXPORT_COLUMNS, toProblemExport, toProblemRow } from '@shared/problem-row'
import type { ExportWorkbook } from '../components/ExportMenu'

type Sheet = ExportWorkbook['sheets'][number]

/**
 * Hojas de la exportación del detalle de un problema: Resumen y Entidades
 * (principales: van también en CSV y TXT), Evidencias y Comentarios.
 * Una hoja sin filas no se envía. Las evidencias van TODAS (la página enseña
 * 50), salvo que pasen del límite global de filas: entonces se recortan y se
 * avisa en la hoja Info.
 */
export function problemWorkbook(
  detail: ProblemDetail,
  loadedAt: Date,
  t: TFunction
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

  // Las evidencias, con lo que queda del límite global después de las demás hojas.
  const others = [summary, entities, comments].reduce(
    (total, sheet) => total + sheet.rows.length,
    0
  )
  const room = Math.max(0, MAX_EXPORT_ROWS - others)
  const kept = detail.evidence.slice(0, room).map(toEvidenceView)
  if (kept.length < detail.evidence.length) {
    warnings.push(
      t('problems.evidenceTruncated', { shown: kept.length, total: detail.evidence.length })
    )
  }
  const evidence: Sheet = {
    name: t('problems.sheets.evidence'),
    primary: false,
    columns: [
      column('type', 'problems.evidenceColumns.type'),
      column('name', 'problems.evidenceColumns.name'),
      column('entity', 'problems.evidenceColumns.entity'),
      column('rootCause', 'problems.evidenceColumns.rootCause'),
      column('start', 'problems.evidenceColumns.start', 'date'),
      // Una fecha o "activo": la columna es de fecha y el texto se guarda como texto.
      column('end', 'problems.evidenceColumns.end', 'date'),
      column('before', 'problems.evidenceColumns.before', 'number'),
      column('after', 'problems.evidenceColumns.after', 'number'),
      column('unit', 'problems.evidenceColumns.unit'),
      column('metricId', 'problems.evidenceColumns.metricId'),
      column('eventType', 'problems.evidenceColumns.eventType')
    ],
    rows: kept.map((item) => ({
      type: item.type,
      name: item.displayName,
      entity: item.entity?.label ?? null,
      rootCause: t(item.rootCause ? 'problems.yes' : 'problems.no'),
      start: item.start,
      end: item.end === 'ACTIVE' ? t('problems.evidenceActive') : item.end,
      before: item.before,
      after: item.after,
      unit: item.unit,
      metricId: item.metricId,
      eventType: item.event?.eventType ?? null
    }))
  }

  return {
    sheets: [summary, entities, evidence, comments].filter(
      (sheet) => sheet.primary || sheet.rows.length > 0
    ),
    warnings
  }
}
