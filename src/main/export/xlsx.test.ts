import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildXlsx } from './index'

/**
 * XLSX con ExcelJS (spec, "Exportación de datos"): cabecera en negrita y fija,
 * autofiltro, anchos, tipos reales, varias hojas si hace falta y hoja "Info".
 * Se comprueba leyendo el fichero generado.
 */

type Column = { key: string; header: string; type: 'string' | 'number' | 'date' }

const columns: Column[] = [
  { key: 'name', header: 'Nombre', type: 'string' },
  { key: 'value', header: 'Valor', type: 'number' },
  { key: 'when', header: 'Inicio', type: 'date' }
]
const T = Date.UTC(2026, 9, 3, 10, 5, 0)
const EXPORTED = new Date('2026-10-03T10:30:00.000Z')

const info = {
  client: 'Cliente A',
  environment: 'Producción',
  module: 'problems',
  query: 'status("open")',
  exportedAt: EXPORTED,
  timeZone: 'Europe/Madrid'
}

async function load(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  return workbook
}

/** Valor de la columna B de la fila cuya columna A es `label` en la hoja Info. */
function infoValue(sheet: ExcelJS.Worksheet, label: string): unknown {
  let found: unknown = undefined
  sheet.eachRow((row) => {
    if (row.getCell(1).value === label) found = row.getCell(2).value
  })
  return found
}

describe('buildXlsx', () => {
  it('hoja de datos con cabecera en negrita y fija, autofiltro, anchos y tipos reales', async () => {
    const workbook = await load(
      await buildXlsx(
        columns,
        [
          { name: 'Año', value: 1.5, when: T },
          { name: 'b', value: -2, when: '2026-10-03T12:05:00+02:00' },
          { name: 'c', value: null, when: null }
        ],
        info
      )
    )
    const sheet = workbook.getWorksheet('Datos')
    expect(sheet).toBeDefined()
    if (sheet === undefined) return

    expect(sheet.getRow(1).values).toEqual([undefined, 'Nombre', 'Valor', 'Inicio'])
    for (let c = 1; c <= 3; c += 1)
      expect(sheet.getRow(1).getCell(c).font?.bold, `cabecera ${c}`).toBe(true)

    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(sheet.autoFilter).toBeTruthy()
    for (let c = 1; c <= 3; c += 1)
      expect(sheet.getColumn(c).width ?? 0, `ancho ${c}`).toBeGreaterThan(0)

    const first = sheet.getRow(2)
    expect(first.getCell(1).value).toBe('Año')
    expect(first.getCell(2).value).toBe(1.5)
    expect(first.getCell(3).value).toBeInstanceOf(Date)
    expect((first.getCell(3).value as Date).getTime()).toBe(T)
    expect((sheet.getRow(3).getCell(3).value as Date).getTime()).toBe(T)
    expect(sheet.getRow(3).getCell(2).value).toBe(-2)
    expect(sheet.getRow(4).getCell(2).value ?? null).toBeNull()
    expect(sheet.getRow(4).getCell(3).value ?? null).toBeNull()
  })

  it('un texto que parece fórmula se guarda como texto, no como fórmula', async () => {
    const workbook = await load(
      await buildXlsx(columns, [{ name: '=SUMA(A1:A9)', value: 1, when: T }], info)
    )
    const cell = workbook.getWorksheet('Datos')?.getRow(2).getCell(1)
    expect(cell?.value).toBe('=SUMA(A1:A9)')
    expect(cell?.type).toBe(ExcelJS.ValueType.String)
  })

  it('reparte las filas en varias hojas al pasar maxRowsPerSheet, cada una con su cabecera', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ name: `fila ${i + 1}`, value: i, when: T }))
    const workbook = await load(await buildXlsx(columns, rows, info, { maxRowsPerSheet: 3 }))

    const names = workbook.worksheets.map((sheet) => sheet.name)
    expect(names).toEqual(expect.arrayContaining(['Datos', 'Datos 2', 'Datos 3', 'Info']))
    expect(names.filter((name) => name.startsWith('Datos'))).toEqual([
      'Datos',
      'Datos 2',
      'Datos 3'
    ])

    const dataRows: string[] = []
    for (const name of ['Datos', 'Datos 2', 'Datos 3']) {
      const sheet = workbook.getWorksheet(name)
      expect(sheet?.getRow(1).getCell(1).value, `cabecera de ${name}`).toBe('Nombre')
      sheet?.eachRow((row, n) => {
        if (n > 1) dataRows.push(String(row.getCell(1).value))
      })
    }
    expect(dataRows).toEqual(rows.map((row) => row.name))
    expect(workbook.getWorksheet('Datos 3')?.actualRowCount).toBe(2)
  })

  it('exactamente maxRowsPerSheet filas caben en una sola hoja', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ name: `f${i}`, value: i, when: T }))
    const workbook = await load(await buildXlsx(columns, rows, info, { maxRowsPerSheet: 3 }))
    expect(
      workbook.worksheets.map((sheet) => sheet.name).filter((n) => n.startsWith('Datos'))
    ).toEqual(['Datos'])
  })

  it('hoja Info con cliente, entorno, módulo, consulta, fecha de exportación y zona horaria', async () => {
    const workbook = await load(await buildXlsx(columns, [], info))
    const sheet = workbook.getWorksheet('Info')
    expect(sheet).toBeDefined()
    if (sheet === undefined) return

    expect(infoValue(sheet, 'Cliente')).toBe('Cliente A')
    expect(infoValue(sheet, 'Entorno')).toBe('Producción')
    expect(infoValue(sheet, 'Módulo')).toBe('problems')
    expect(infoValue(sheet, 'Consulta')).toBe('status("open")')
    expect(infoValue(sheet, 'Exportado')).toBeInstanceOf(Date)
    expect((infoValue(sheet, 'Exportado') as Date).getTime()).toBe(EXPORTED.getTime())
    expect(infoValue(sheet, 'Zona horaria')).toBe('Europe/Madrid')
    // Sin rango, no hay filas de rango.
    expect(infoValue(sheet, 'Rango')).toBeUndefined()
    expect(infoValue(sheet, 'Desde')).toBeUndefined()
    expect(infoValue(sheet, 'Hasta')).toBeUndefined()
  })

  it('con rango, la hoja Info lleva Rango, Desde y Hasta como fechas', async () => {
    const from = new Date('2026-10-03T08:30:00.000Z')
    const workbook = await load(
      await buildXlsx(columns, [], { ...info, range: 'now-2h', from, to: EXPORTED })
    )
    const sheet = workbook.getWorksheet('Info')
    if (sheet === undefined) throw new Error('falta la hoja Info')
    expect(infoValue(sheet, 'Rango')).toBe('now-2h')
    expect((infoValue(sheet, 'Desde') as Date).getTime()).toBe(from.getTime())
    expect((infoValue(sheet, 'Hasta') as Date).getTime()).toBe(EXPORTED.getTime())
  })

  it('con etiquetas en inglés, las hojas y la Info van en inglés', async () => {
    const labels = {
      dataSheet: 'Data',
      infoSheet: 'Info',
      client: 'Client',
      environment: 'Environment',
      module: 'Module',
      query: 'Query',
      exported: 'Exported',
      timeZone: 'Time zone',
      range: 'Range',
      from: 'From',
      to: 'To'
    }
    const rows = Array.from({ length: 4 }, (_, i) => ({ name: `r${i}`, value: i, when: T }))
    const workbook = await load(
      await buildXlsx(
        columns,
        rows,
        { ...info, range: 'now-2h', from: new Date(T), to: EXPORTED },
        { maxRowsPerSheet: 3, labels }
      )
    )

    expect(workbook.worksheets.map((sheet) => sheet.name).sort()).toEqual([
      'Data',
      'Data 2',
      'Info'
    ])
    const sheet = workbook.getWorksheet('Info')
    if (sheet === undefined) throw new Error('falta la hoja Info')
    expect(infoValue(sheet, 'Client')).toBe('Cliente A')
    expect(infoValue(sheet, 'Environment')).toBe('Producción')
    expect(infoValue(sheet, 'Module')).toBe('problems')
    expect(infoValue(sheet, 'Query')).toBe('status("open")')
    expect(infoValue(sheet, 'Exported')).toBeInstanceOf(Date)
    expect(infoValue(sheet, 'Time zone')).toBe('Europe/Madrid')
    expect(infoValue(sheet, 'Range')).toBe('now-2h')
    expect(infoValue(sheet, 'From')).toBeInstanceOf(Date)
    expect(infoValue(sheet, 'To')).toBeInstanceOf(Date)
    // Nada en español cuando se pasan etiquetas.
    expect(infoValue(sheet, 'Cliente')).toBeUndefined()
  })

  it('sin consulta, la fila Consulta queda vacía o no aparece, pero no falla', async () => {
    const { query: _query, ...withoutQuery } = info
    void _query
    const workbook = await load(
      await buildXlsx(columns, [{ name: 'a', value: 1, when: T }], withoutQuery)
    )
    expect(workbook.getWorksheet('Info')).toBeDefined()
  })
})

describe('AUD-09: celdas de una columna number', () => {
  /** Valor de la celda de datos de una fila con `value` en la columna number. */
  async function numberCell(value: unknown): Promise<unknown> {
    const workbook = await load(
      await buildXlsx(columns, [{ name: 'a', value: value as number, when: T }], info)
    )
    return workbook.getWorksheet('Datos')?.getRow(2).getCell(2).value ?? null
  }

  it('un número finito se guarda como número', async () => {
    expect(await numberCell(-3.5)).toBe(-3.5)
    expect(await numberCell(0)).toBe(0)
  })

  it('un texto numérico («12», « 7 ») se guarda como número', async () => {
    expect(await numberCell('12')).toBe(12)
    expect(await numberCell(' 7 ')).toBe(7)
  })

  it.each([
    ['un texto no numérico', 'abc'],
    ['una fórmula', '=1+1'],
    ['un texto vacío', ''],
    ['solo espacios', '   '],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY]
  ])('%s → celda vacía (nunca NaN ni fórmula)', async (_case, value) => {
    expect(await numberCell(value)).toBeNull()
  })
})

describe('AUD-09: columnas string y date con texto de fórmula', () => {
  it('string: se guarda como texto, nunca como fórmula', async () => {
    const workbook = await load(
      await buildXlsx(columns, [{ name: '=HYPERLINK("http://x","y")', value: 1, when: T }], info)
    )
    const cell = workbook.getWorksheet('Datos')?.getRow(2).getCell(1)
    expect(cell?.value).toBe('=HYPERLINK("http://x","y")')
    expect(cell?.formula).toBeUndefined()
  })

  it('date: un texto que no es fecha se guarda como texto, no como fórmula', async () => {
    const workbook = await load(
      await buildXlsx(columns, [{ name: 'a', value: 1, when: '=1+1' }], info)
    )
    const cell = workbook.getWorksheet('Datos')?.getRow(2).getCell(3)
    expect(cell?.value).toBe('=1+1')
    expect(cell?.formula).toBeUndefined()
  })

  it('date: una fecha ISO válida como texto se guarda como fecha', async () => {
    const workbook = await load(
      await buildXlsx(columns, [{ name: 'a', value: 1, when: '2026-10-03T10:05:00Z' }], info)
    )
    const value = workbook.getWorksheet('Datos')?.getRow(2).getCell(3).value
    expect(value).toBeInstanceOf(Date)
    expect((value as Date).toISOString()).toBe('2026-10-03T10:05:00.000Z')
  })
})
