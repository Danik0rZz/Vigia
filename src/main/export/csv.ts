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

/** Cabecera y filas de una tabla, ya como líneas CSV. */
function csvLines(columns: ExportColumn[], rows: ExportRow[], separator: ';' | ','): string[] {
  const header = columns
    .map((column) => csvCell({ ...column, type: 'string' }, column.header, separator))
    .join(separator)
  const lines = rows.map((row) =>
    columns.map((column) => csvCell(column, row[column.key], separator)).join(separator)
  )
  return [header, ...lines]
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
  return Buffer.from(`${BOM}${csvLines(columns, rows, options.separator).join('\r\n')}\r\n`, 'utf8')
}

/**
 * Varias tablas en un solo CSV: cada bloque empieza con su título (una celda,
 * neutralizada como cualquier texto) y su cabecera; entre bloques, una línea en
 * blanco.
 */
export function buildCsvSections(
  sections: { title: string; columns: ExportColumn[]; rows: ExportRow[] }[],
  options: { separator: ';' | ',' }
): Buffer {
  const { separator } = options
  const blocks = sections.map((section) =>
    [
      csvCell({ key: 'title', header: '', type: 'string' }, section.title, separator),
      ...csvLines(section.columns, section.rows, separator)
    ].join('\r\n')
  )
  return Buffer.from(`${BOM}${blocks.join('\r\n\r\n')}\r\n`, 'utf8')
}
