import { cellText, type ExportColumn, type ExportRow } from './format'

/**
 * Tabla en texto: alineada en columnas con espacios (cabecera y una línea de
 * guiones) o separada por tabuladores. UTF-8 sin BOM, fechas en ISO UTC.
 */
export function buildTxt(
  columns: ExportColumn[],
  rows: ExportRow[],
  options: { tabs: boolean }
): Buffer {
  const header = columns.map((column) => column.header)
  const body = rows.map((row) => columns.map((column) => cellText(column, row[column.key])))

  if (options.tabs) {
    return Buffer.from(
      `${[header, ...body].map((line) => line.join('\t')).join('\r\n')}\r\n`,
      'utf8'
    )
  }

  const widths = columns.map((_column, index) =>
    Math.max(...[header, ...body].map((line) => [...(line[index] ?? '')].length))
  )
  const pad = (cells: string[]): string =>
    cells
      .map((cell, index) => cell + ' '.repeat((widths[index] ?? 0) - [...cell].length))
      .join('  ')
      .trimEnd()
  const rule = widths.map((width) => '-'.repeat(width)).join('  ')
  return Buffer.from(`${[pad(header), rule, ...body.map(pad)].join('\r\n')}\r\n`, 'utf8')
}
