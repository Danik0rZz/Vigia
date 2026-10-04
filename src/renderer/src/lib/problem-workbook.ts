import type { TFunction } from 'i18next'
import { MAX_EXPORT_ROWS, type ExportColumn, type ProblemDetail } from '@shared/modules'
import { PROBLEM_EXPORT_COLUMNS, toProblemExport, toProblemRow } from '@shared/problem-row'
import type { ExportWorkbook } from '../components/ExportMenu'

type Sheet = ExportWorkbook['sheets'][number]

/**
 * Hojas de la exportación del detalle de un problema: Resumen y Entidades
 * (principales: van también en CSV y TXT), Evidencias, Impacto y Comentarios.
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

  // "Usuarios afectados" solo si Dynatrace lo da en algún impacto: no se calcula.
  const withUsers = detail.impacts.some((impact) => impact.estimatedAffectedUsers !== null)
  const impacts: Sheet = {
    name: t('problems.sheets.impact'),
    primary: false,
    columns: [
      column('entity', 'problems.impactColumns.entity'),
      column('type', 'problems.impactColumns.type'),
      ...(withUsers ? [column('users', 'problems.impactColumns.users', 'number')] : [])
    ],
    rows: detail.impacts.map((impact) => ({
      entity: impact.entity,
      type: impact.type,
      ...(withUsers ? { users: impact.estimatedAffectedUsers } : {})
    }))
  }

  const comments: Sheet = {
    name: t('problems.sheets.comments'),
    primary: false,
    columns: [
      column('author', 'problems.commentColumns.author'),
      column('date', 'problems.commentColumns.date', 'date'),
      column('content', 'problems.commentColumns.content')
    ],
    rows: detail.comments.map((comment) => ({
      author: comment.author,
      date: comment.createdAt,
      content: comment.content
    }))
  }

  // Las evidencias, con lo que queda del límite global después de las demás hojas.
  const others = [summary, entities, impacts, comments].reduce(
    (total, sheet) => total + sheet.rows.length,
    0
  )
  const room = Math.max(0, MAX_EXPORT_ROWS - others)
  const kept = detail.evidence.slice(0, room)
  const warnings =
    kept.length < detail.evidence.length
      ? [t('problems.evidenceTruncated', { shown: kept.length, total: detail.evidence.length })]
      : []
  const evidence: Sheet = {
    name: t('problems.sheets.evidence'),
    primary: false,
    columns: [
      column('type', 'problems.evidenceColumns.type'),
      column('name', 'problems.evidenceColumns.name'),
      column('entity', 'problems.evidenceColumns.entity'),
      column('start', 'problems.evidenceColumns.start', 'date')
    ],
    rows: kept.map((item) => ({
      type: item.type,
      name: item.name,
      entity: item.entity,
      start: item.startTime
    }))
  }

  return {
    sheets: [summary, entities, evidence, impacts, comments].filter(
      (sheet) => sheet.primary || sheet.rows.length > 0
    ),
    warnings
  }
}
