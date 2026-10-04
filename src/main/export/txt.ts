import { cellText, type ExportColumn, type ExportRow } from './format'

/** Cabecera y filas de una tabla, ya como líneas de texto. */
function txtLines(columns: ExportColumn[], rows: ExportRow[], tabs: boolean): string[] {
  const header = columns.map((column) => column.header)
  const body = rows.map((row) => columns.map((column) => cellText(column, row[column.key])))

  if (tabs) return [header, ...body].map((line) => line.join('\t'))

  const widths = columns.map((_column, index) =>
    Math.max(...[header, ...body].map((line) => [...(line[index] ?? '')].length))
  )
  const pad = (cells: string[]): string =>
    cells
      .map((cell, index) => cell + ' '.repeat((widths[index] ?? 0) - [...cell].length))
      .join('  ')
      .trimEnd()
  const rule = widths.map((width) => '-'.repeat(width)).join('  ')
  return [pad(header), rule, ...body.map(pad)]
}

/**
 * Tabla en texto: alineada en columnas con espacios (cabecera y una línea de
 * guiones) o separada por tabuladores. UTF-8 sin BOM, fechas en ISO UTC.
 */
export function buildTxt(
  columns: ExportColumn[],
  rows: ExportRow[],
  options: { tabs: boolean }
): Buffer {
  return Buffer.from(`${txtLines(columns, rows, options.tabs).join('\r\n')}\r\n`, 'utf8')
}

/** Varias tablas en un solo texto: cada bloque con su título y una línea en blanco entre bloques. */
export function buildTxtSections(
  sections: { title: string; columns: ExportColumn[]; rows: ExportRow[] }[],
  options: { tabs: boolean }
): Buffer {
  const blocks = sections.map((section) =>
    [section.title, ...txtLines(section.columns, section.rows, options.tabs)].join('\r\n')
  )
  return Buffer.from(`${blocks.join('\r\n\r\n')}\r\n`, 'utf8')
}
