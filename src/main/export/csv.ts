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
  // Se neutraliza todo valor que llegue como TEXTO, sea cual sea el tipo de la
  // columna: main no se fía del renderer (un texto en una columna number o date
  // también puede ser una fórmula). Un número de verdad (-5) no se toca.
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`
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
