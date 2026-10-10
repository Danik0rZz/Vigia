import { cellText, type ExportColumn, type ExportRow } from './format'

/** Cabecera y filas de una tabla, ya como líneas de texto. */
function txtLines(columns: ExportColumn[], rows: ExportRow[], tabs: boolean): string[] {
  const header = columns.map((column) => column.header)
  const body = rows.map((row) => columns.map((column) => cellText(column, row[column.key])))

  // Sin spread de la tabla entera en ningún sitio: `concat` no depende de la pila (ficha 0063).
  if (tabs) return [header].concat(body).map((line) => line.join('\t'))

  // Ancho de cada columna con un bucle: `Math.max(...)` con una tabla grande (cien mil filas o más)
  // pasa del límite de argumentos de Node y lanza RangeError (ficha 0063).
  const widths = header.map((cell) => [...cell].length)
  for (const line of body) {
    line.forEach((cell, index) => {
      const length = [...cell].length
      if (length > (widths[index] ?? 0)) widths[index] = length
    })
  }
  const pad = (cells: string[]): string =>
    cells
      .map((cell, index) => cell + ' '.repeat((widths[index] ?? 0) - [...cell].length))
      .join('  ')
      .trimEnd()
  const rule = widths.map((width) => '-'.repeat(width)).join('  ')
  return [pad(header), rule].concat(body.map(pad))
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
    [section.title].concat(txtLines(section.columns, section.rows, options.tabs)).join('\r\n')
  )
  return Buffer.from(`${blocks.join('\r\n\r\n')}\r\n`, 'utf8')
}
