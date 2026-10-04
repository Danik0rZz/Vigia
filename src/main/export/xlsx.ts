import ExcelJS from 'exceljs'
import type { XlsxLabels } from '@shared/modules'
import { toDate, type ExportColumn, type ExportRow } from './format'

/** Etiquetas si el renderer no manda las suyas (las traduce la interfaz; main no traduce). */
export const DEFAULT_XLSX_LABELS: XlsxLabels = {
  dataSheet: 'Datos',
  infoSheet: 'Info',
  client: 'Cliente',
  environment: 'Entorno',
  module: 'Módulo',
  query: 'Consulta',
  exported: 'Exportado',
  timeZone: 'Zona horaria',
  range: 'Rango',
  from: 'Desde',
  to: 'Hasta',
  note: 'Nota',
  warning: 'Aviso',
  invalidItems: 'Elementos descartados',
  clusterFilter: 'Filtro de clúster',
  resolution: 'Resolución'
}

/** Filas de datos por hoja que admite Excel (1.048.576 menos la cabecera). */
export const EXCEL_MAX_ROWS = 1_048_575

export interface XlsxInfo {
  client: string
  environment: string
  module: string
  query?: string | undefined
  exportedAt: Date
  timeZone: string
  /** Rango relativo de la vista (now-2h…) y sus fechas absolutas al exportar. */
  range?: string | undefined
  from?: Date | undefined
  to?: Date | undefined
  /** Aclaración del módulo sobre los datos (por ejemplo, qué significa un fin vacío). */
  note?: string | undefined
  /** Avisos de Dynatrace sobre los datos exportados: una fila por aviso. */
  warnings?: readonly string[] | undefined
  /** Elementos descartados al leer la lista: fila propia si hay alguno. */
  invalidCount?: number | undefined
  /** Clústeres del filtro local: los datos exportados no son el total. */
  clusterFilter?: readonly string[] | undefined
  /** Resolución aplicada por la API (Métricas). */
  resolution?: string | undefined
}

const MIN_WIDTH = 8
const MAX_WIDTH = 60

function cellValue(
  column: ExportColumn,
  value: string | number | null | undefined
): ExcelJS.CellValue {
  if (value === null || value === undefined) return null
  if (column.type === 'date') return toDate(value) ?? String(value)
  if (column.type === 'number') {
    // Un texto que no es número (o NaN o infinito) deja la celda vacía, no NaN.
    const number = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(number) && !(typeof value === 'string' && value.trim() === '')
      ? number
      : null
  }
  // Texto: se guarda como String, nunca como fórmula aunque empiece por "=".
  return String(value)
}

function addDataSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: ExportColumn[],
  rows: ExportRow[]
): void {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = columns.map((column) => {
    const longest = Math.max(
      column.header.length,
      ...rows.slice(0, 1000).map((row) => String(row[column.key] ?? '').length)
    )
    return {
      header: column.header,
      key: column.key,
      width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, column.type === 'date' ? 20 : longest + 2)),
      style: column.type === 'date' ? { numFmt: 'yyyy-mm-dd hh:mm:ss' } : {}
    }
  })
  sheet.getRow(1).font = { bold: true }
  for (const row of rows) {
    sheet.addRow(
      Object.fromEntries(columns.map((column) => [column.key, cellValue(column, row[column.key])]))
    )
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
}

/**
 * XLSX con ExcelJS: cabecera en negrita y fija, autofiltro, anchos, fechas y
 * números con su tipo real, varias hojas si se pasa del límite de Excel y una
 * hoja "Info" con el contexto de la exportación (etiquetas en español).
 */
export async function buildXlsx(
  columns: ExportColumn[],
  rows: ExportRow[],
  info: XlsxInfo,
  options: { maxRowsPerSheet?: number; labels?: XlsxLabels | undefined } = {}
): Promise<Buffer> {
  const labels = options.labels ?? DEFAULT_XLSX_LABELS
  const maxRows = options.maxRowsPerSheet ?? EXCEL_MAX_ROWS
  const workbook = new ExcelJS.Workbook()
  workbook.created = info.exportedAt

  const chunks = rows.length === 0 ? 1 : Math.ceil(rows.length / maxRows)
  for (let index = 0; index < chunks; index += 1) {
    addDataSheet(
      workbook,
      index === 0 ? labels.dataSheet : `${labels.dataSheet} ${index + 1}`,
      columns,
      rows.slice(index * maxRows, (index + 1) * maxRows)
    )
  }

  const infoSheet = workbook.addWorksheet(labels.infoSheet)
  infoSheet.columns = [
    { key: 'label', width: 16 },
    { key: 'value', width: 50 }
  ]
  const entries: [string, ExcelJS.CellValue][] = [
    [labels.client, info.client],
    [labels.environment, info.environment],
    [labels.module, info.module],
    [labels.query, info.query ?? ''],
    [labels.exported, info.exportedAt],
    [labels.timeZone, info.timeZone]
  ]
  if (info.range !== undefined) entries.push([labels.range, info.range])
  if (info.from !== undefined) entries.push([labels.from, info.from])
  if (info.to !== undefined) entries.push([labels.to, info.to])
  if (info.note !== undefined) {
    entries.push([labels.note ?? DEFAULT_XLSX_LABELS.note ?? '', info.note])
  }
  if (info.resolution !== undefined) {
    entries.push([labels.resolution ?? DEFAULT_XLSX_LABELS.resolution ?? '', info.resolution])
  }
  if (info.clusterFilter !== undefined && info.clusterFilter.length > 0) {
    entries.push([
      labels.clusterFilter ?? DEFAULT_XLSX_LABELS.clusterFilter ?? '',
      info.clusterFilter.join(' | ')
    ])
  }
  if (info.invalidCount !== undefined && info.invalidCount > 0) {
    entries.push([labels.invalidItems ?? DEFAULT_XLSX_LABELS.invalidItems ?? '', info.invalidCount])
  }
  for (const warning of info.warnings ?? []) {
    entries.push([labels.warning ?? DEFAULT_XLSX_LABELS.warning ?? '', warning])
  }
  for (const [label, value] of entries) {
    const row = infoSheet.addRow({ label, value })
    row.getCell(1).font = { bold: true }
    if (value instanceof Date) row.getCell(2).numFmt = 'yyyy-mm-dd hh:mm:ss'
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}
