import type { ExportColumn, ExportRow } from '@shared/modules'

export type { ExportColumn, ExportRow }

/** Fecha de una celda: en ms o en ISO. `null` si no es una fecha válida. */
export function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Texto plano de una celda (TXT y base del CSV): fechas en ISO UTC y punto decimal. */
export function cellText(column: ExportColumn, value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  // NaN e infinitos no son datos: celda vacía.
  if (typeof value === 'number' && !Number.isFinite(value)) return ''
  if (column.type === 'date') return toDate(value)?.toISOString() ?? String(value)
  return String(value)
}
