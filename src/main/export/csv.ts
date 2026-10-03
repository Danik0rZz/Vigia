import { cellText, type ExportColumn, type ExportRow } from './format'

const BOM = '﻿'

/** Inicios con los que Excel interpreta una celda como fórmula (OWASP, CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/

function csvCell(
  column: ExportColumn,
  value: string | number | null | undefined,
  separator: ';' | ','
): string {
  let text = cellText(column, value)
  if (column.type === 'number' && typeof value === 'number' && separator === ';') {
    // Con ';' (Excel en español) el decimal va con coma.
    text = text.replace('.', ',')
  }
  // Solo el texto se neutraliza: un número negativo es un número, no una fórmula.
  if (column.type === 'string' && FORMULA_START.test(text)) text = `'${text}`
  if (text.includes(separator) || /["\r\n]/.test(text)) text = `"${text.replaceAll('"', '""')}"`
  return text
}

/**
 * CSV para Excel: UTF-8 con BOM (acentos y eñes), CRLF, comillas RFC 4180 y
 * fórmulas neutralizadas. Con ';' los decimales van con coma.
 */
export function buildCsv(
  columns: ExportColumn[],
  rows: ExportRow[],
  options: { separator: ';' | ',' }
): Buffer {
  const { separator } = options
  const header = columns
    .map((column) => csvCell({ ...column, type: 'string' }, column.header, separator))
    .join(separator)
  const lines = rows.map((row) =>
    columns.map((column) => csvCell(column, row[column.key], separator)).join(separator)
  )
  return Buffer.from(`${BOM}${[header, ...lines].join('\r\n')}\r\n`, 'utf8')
}
