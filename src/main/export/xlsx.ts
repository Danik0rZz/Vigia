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
/** Longitud máxima del nombre de una hoja en Excel. */
const EXCEL_MAX_SHEET_NAME = 31

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

/**
 * Fecha para una celda de Excel en hora local (decisión de Dani, ficha 0063). ExcelJS pasa un
 * `Date` a número de Excel en UTC, y Excel no tiene zona: enseña ese número tal cual. Se construye
 * el instante con los componentes locales (con los getters locales, que ya aplican el horario de
 * verano que tocaba en esa fecha) como si fueran UTC, y así Excel enseña la hora local, la misma
 * zona que dice la fila «Zona horaria» de Info. Se conservan los milisegundos.
 */
export function toExcelLocal(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
      date.getMilliseconds()
    )
  )
}

function cellValue(
  column: ExportColumn,
  value: string | number | null | undefined
): ExcelJS.CellValue {
  if (value === null || value === undefined) return null
  if (column.type === 'date') {
    const date = toDate(value)
    return date === null ? String(value) : toExcelLocal(date)
  }
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

/** Nombre de la hoja n.º `part` (desde 1) de un reparto, sin pasar de 31 caracteres. */
export function partSheetName(name: string, part: number): string {
  if (part === 1) return name.slice(0, EXCEL_MAX_SHEET_NAME)
  const suffix = ` ${part}`
  return `${name.slice(0, EXCEL_MAX_SHEET_NAME - suffix.length)}${suffix}`
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
  return buildWorkbook([{ name: labels.dataSheet, columns, rows }], info, options)
}

/**
 * Libro con varias hojas de datos (cada una con el formato de `buildXlsx`, y
 * repartida si pasa del límite de Excel) y una sola hoja "Info" al final.
 */
export async function buildWorkbook(
  sheets: { name: string; columns: ExportColumn[]; rows: ExportRow[] }[],
  info: XlsxInfo,
  options: { maxRowsPerSheet?: number; labels?: XlsxLabels | undefined } = {}
): Promise<Buffer> {
  const labels = options.labels ?? DEFAULT_XLSX_LABELS
  const maxRows = options.maxRowsPerSheet ?? EXCEL_MAX_ROWS
  const workbook = new ExcelJS.Workbook()
  workbook.created = info.exportedAt

  for (const sheet of sheets) {
    const chunks = sheet.rows.length === 0 ? 1 : Math.ceil(sheet.rows.length / maxRows)
    for (let index = 0; index < chunks; index += 1) {
      addDataSheet(
        workbook,
        partSheetName(sheet.name, index + 1),
        sheet.columns,
        sheet.rows.slice(index * maxRows, (index + 1) * maxRows)
      )
    }
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
    [labels.exported, toExcelLocal(info.exportedAt)],
    [labels.timeZone, info.timeZone]
  ]
  if (info.range !== undefined) entries.push([labels.range, info.range])
  if (info.from !== undefined) entries.push([labels.from, toExcelLocal(info.from)])
  if (info.to !== undefined) entries.push([labels.to, toExcelLocal(info.to)])
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
