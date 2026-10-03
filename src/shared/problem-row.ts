import type { ExportColumn, ExportRow, ProblemSummary } from './modules'

/** Valor ausente, igual en los dos idiomas. */
export const NA = 'N/A'

const MINUTE_MS = 60_000

/**
 * Fila de un problema, común a la tabla y a la exportación: ninguna de las dos
 * calcula nada por su cuenta. Las listas van en el mismo orden (nombre, tipo e
 * id de cada entidad afectada).
 */
export interface ProblemRow {
  problemId: string
  displayId: string
  title: string
  status: 'OPEN' | 'CLOSED'
  impactLevel: string
  severityLevel: string
  /** Nombre de cada entidad afectada, o su id si no tiene nombre. */
  affectedNames: string[]
  affectedTypes: string[]
  affectedIds: string[]
  rootCauseName: string | null
  rootCauseType: string | null
  rootCauseId: string | null
  clusters: string[]
  namespaces: string[]
  startTime: number
  /** null mientras el problema sigue abierto. */
  endTime: number | null
  /** Hasta el fin o, si está abierto, hasta `now`; por diferencia de ms, no con horas locales. */
  durationMinutes: number
  ongoing: boolean
}

/** N/A si el valor es null, no viene o solo tiene espacios. */
export function naIfEmpty(value: string | null | undefined): string {
  return value === null || value === undefined || value.trim() === '' ? NA : value
}

/** Primer valor de una lista (la tabla añade "+N"), o N/A si está vacía. */
export function displayList(values: readonly string[]): string {
  return values[0] ?? NA
}

/** Todos los valores separados con " | " (exportación), o N/A si la lista está vacía. */
export function joinValues(values: readonly string[]): string {
  return values.length === 0 ? NA : values.join(' | ')
}

export function toProblemRow(problem: ProblemSummary, now: Date): ProblemRow {
  const end = problem.endTime
  return {
    problemId: problem.problemId,
    displayId: problem.displayId,
    title: problem.title,
    status: problem.status,
    impactLevel: problem.impactLevel,
    severityLevel: problem.severityLevel,
    affectedNames: problem.affectedEntities.map((entity) => entity.name ?? entity.id),
    affectedTypes: problem.affectedEntities.map((entity) => entity.type),
    affectedIds: problem.affectedEntities.map((entity) => entity.id),
    rootCauseName:
      problem.rootCause === null ? null : (problem.rootCause.name ?? problem.rootCause.id),
    rootCauseType: problem.rootCause?.type ?? null,
    rootCauseId: problem.rootCause?.id ?? null,
    clusters: problem.clusters,
    namespaces: problem.namespaces,
    startTime: problem.startTime,
    endTime: end,
    durationMinutes: Math.round(((end ?? now.getTime()) - problem.startTime) / MINUTE_MS),
    ongoing: end === null
  }
}

/** Columnas de la exportación de problemas; las cabeceras las traduce la interfaz. */
export const PROBLEM_EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: 'displayId', header: 'displayId', type: 'string' },
  { key: 'title', header: 'title', type: 'string' },
  { key: 'status', header: 'status', type: 'string' },
  { key: 'impactLevel', header: 'impactLevel', type: 'string' },
  { key: 'severityLevel', header: 'severityLevel', type: 'string' },
  { key: 'affectedNames', header: 'affectedNames', type: 'string' },
  { key: 'affectedTypes', header: 'affectedTypes', type: 'string' },
  { key: 'affectedIds', header: 'affectedIds', type: 'string' },
  { key: 'rootCauseName', header: 'rootCauseName', type: 'string' },
  { key: 'rootCauseType', header: 'rootCauseType', type: 'string' },
  { key: 'rootCauseId', header: 'rootCauseId', type: 'string' },
  { key: 'clusters', header: 'clusters', type: 'string' },
  { key: 'namespaces', header: 'namespaces', type: 'string' },
  { key: 'startTime', header: 'startTime', type: 'date' },
  { key: 'endTime', header: 'endTime', type: 'date' },
  { key: 'durationMinutes', header: 'durationMinutes', type: 'number' },
  { key: 'problemId', header: 'problemId', type: 'string' }
]

/** Fila exportada: los valores múltiples con " | ", el fin vacío si está abierto. */
export function toProblemExport(row: ProblemRow): ExportRow {
  return {
    displayId: row.displayId,
    title: row.title,
    status: row.status,
    impactLevel: row.impactLevel,
    severityLevel: row.severityLevel,
    affectedNames: joinValues(row.affectedNames),
    affectedTypes: joinValues(row.affectedTypes),
    affectedIds: joinValues(row.affectedIds),
    rootCauseName: naIfEmpty(row.rootCauseName),
    rootCauseType: naIfEmpty(row.rootCauseType),
    rootCauseId: naIfEmpty(row.rootCauseId),
    clusters: joinValues(row.clusters),
    namespaces: joinValues(row.namespaces),
    startTime: row.startTime,
    endTime: row.endTime,
    durationMinutes: row.durationMinutes,
    problemId: row.problemId
  }
}
