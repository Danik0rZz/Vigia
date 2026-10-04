import { dirname, join } from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcChannel } from '@shared/ipc'
import type { AppDatabase } from '../../db/database'
import { createSettingsStore } from '../../settings/store'
import { createTenantRepository } from '../../tenants/repository'
import { createIpcHandler, type IpcHandlerDeps, type IpcImplementation } from '../handler'
import { createExportHandlers } from './export'
import { createTestDb } from '../../../test/fixtures'

/**
 * Canales de exportación y captura: los ficheros los escribe main, con el
 * nombre acordado, en VIGIA_EXPORT_DIR o con el diálogo y la última carpeta.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const NOW = new Date(2026, 9, 3, 9, 5) // hora local: el nombre no depende de la zona del equipo
const STAMP = '20261003-0905'
// PNG real de 1×1 píxel.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`

let db: AppDatabase
let envId: string
let settings: ReturnType<typeof createSettingsStore>
let written: Map<string, Buffer>
let dialogAnswer: string | null
let chooseSaveFile: ReturnType<typeof vi.fn>
let clipboardImages: Buffer[]
let capturePage: ReturnType<typeof vi.fn>
let deps: IpcHandlerDeps
let called: Set<string>

const columns = [
  { key: 'displayId', header: 'displayId', type: 'string' },
  { key: 'title', header: 'title', type: 'string' },
  { key: 'count', header: 'count', type: 'number' },
  { key: 'startTime', header: 'startTime', type: 'date' }
]
const rows = [
  { displayId: 'P-1', title: '=cmd', count: 1.5, startTime: Date.UTC(2026, 9, 3, 8, 0) },
  { displayId: 'P-2', title: 'Año', count: -2, startTime: null }
]

function build(exportDir: string | null): ReturnType<typeof createExportHandlers> {
  return createExportHandlers({
    repo: createTenantRepository(db),
    settings,
    exportDir,
    dialogs: { chooseSaveFile },
    writeFile: async (path: string, data: Buffer) => {
      written.set(path, data)
    },
    clipboard: { writeImage: (png: Buffer) => clipboardImages.push(png) },
    window: { size: () => ({ width: 800, height: 600 }), capturePage },
    now: () => NOW,
    timeZone: () => 'Europe/Madrid'
  } as unknown as Parameters<typeof createExportHandlers>[0])
}

async function call(
  handlers: ReturnType<typeof createExportHandlers>,
  channel: IpcChannel,
  input?: unknown
): Promise<{ ok: boolean; data?: unknown; error?: { code: string } }> {
  const implementation = (handlers as Record<string, unknown>)[channel] as IpcImplementation<
    typeof channel
  >
  expect(implementation, `implementación de ${channel}`).toBeTypeOf('function')
  called.add(channel)
  return (await createIpcHandler(channel, implementation, deps)(TRUSTED, input)) as {
    ok: boolean
    data?: unknown
    error?: { code: string }
  }
}

beforeEach(() => {
  db = createTestDb()
  const repo = createTenantRepository(db)
  const client = repo.createClient({ name: 'Cliente A', color: '#111111' })
  envId = repo.createEnvironment({
    clientId: client.id,
    name: 'Producción',
    type: 'production',
    deployment: 'saas',
    classicApiUrl: 'https://abc12345.live.dynatrace.com',
    platformUrl: null,
    ssoUrl: null,
    oauthClientId: null,
    oauthScopes: [],
    accountUuid: null,
    certificateLevel: 'system',
    captureUrlPatterns: [],
    tags: [],
    readOnly: false
  }).id
  settings = createSettingsStore(db)
  written = new Map()
  dialogAnswer = null
  chooseSaveFile = vi.fn(async () => dialogAnswer)
  clipboardImages = []
  capturePage = vi.fn(async () => Buffer.from(PNG_BASE64, 'base64'))
  deps = { isTrustedSender: () => true, logger: { warn: vi.fn(), error: vi.fn() } }
  called = new Set()
})

afterEach(() => {
  db.$client.close()
})

const table = (format: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  environmentId: envId,
  module: 'problems',
  format,
  columns,
  rows,
  ...extra
})

describe('export:table con VIGIA_EXPORT_DIR', () => {
  const dir = join('C:', 'exportaciones')

  it('guarda el CSV sin diálogo con el nombre acordado, BOM y ";" por defecto', async () => {
    const result = await call(build(dir), 'export:table', table('csv'))
    const name = `Cliente_A_Producción_problems_${STAMP}.csv`

    expect(result).toEqual({ ok: true, data: { status: 'saved', fileName: name } })
    expect(chooseSaveFile).not.toHaveBeenCalled()
    const buffer = written.get(join(dir, name))
    expect(buffer).toBeDefined()
    expect([...(buffer ?? Buffer.alloc(0)).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const lines = (buffer ?? Buffer.alloc(0)).subarray(3).toString('utf8').split('\r\n')
    expect(lines[0]).toBe('displayId;title;count;startTime')
    expect(lines[1]).toBe("P-1;'=cmd;1,5;2026-10-03T08:00:00.000Z")
  })

  it('usa el separador guardado en Ajustes', async () => {
    const handlers = build(dir)
    expect(await call(handlers, 'export:setSettings', { csvSeparator: ',' })).toMatchObject({
      ok: true,
      data: { csvSeparator: ',' }
    })
    await call(handlers, 'export:table', table('csv'))
    const lines = [...written.values()][0]?.subarray(3).toString('utf8').split('\r\n') ?? []
    expect(lines[0]).toBe('displayId,title,count,startTime')
    expect(lines[1]).toBe("P-1,'=cmd,1.5,2026-10-03T08:00:00.000Z")
  })

  it('XLSX con la hoja Info: nombres reales, consulta, rango con fechas y zona horaria', async () => {
    const result = await call(
      build(dir),
      'export:table',
      table('xlsx', { query: 'status("open")', timeRange: '2h' })
    )
    expect(result).toMatchObject({
      ok: true,
      data: { status: 'saved', fileName: `Cliente_A_Producción_problems_${STAMP}.xlsx` }
    })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load([...written.values()][0] as unknown as ArrayBuffer)
    const info: Record<string, unknown> = {}
    workbook.getWorksheet('Info')?.eachRow((row) => {
      info[String(row.getCell(1).value)] = row.getCell(2).value
    })
    expect(info).toMatchObject({
      Cliente: 'Cliente A',
      Entorno: 'Producción',
      Consulta: 'status("open")',
      Rango: 'now-2h',
      'Zona horaria': 'Europe/Madrid'
    })
    expect((info['Hasta'] as Date).getTime()).toBe(NOW.getTime())
    expect((info['Desde'] as Date).getTime()).toBe(NOW.getTime() - 2 * 3600_000)
    expect(workbook.getWorksheet('Datos')?.getRow(2).getCell(4).value).toBeInstanceOf(Date)
  })

  it('XLSX con xlsxLabels: hojas e Info con las etiquetas recibidas', async () => {
    const xlsxLabels = {
      dataSheet: 'Data',
      infoSheet: 'Details',
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
    await call(build(dir), 'export:table', table('xlsx', { timeRange: '24h', xlsxLabels }))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load([...written.values()][0] as unknown as ArrayBuffer)
    expect(workbook.worksheets.map((sheet) => sheet.name).sort()).toEqual(['Data', 'Details'])
    const info: Record<string, unknown> = {}
    workbook.getWorksheet('Details')?.eachRow((row) => {
      info[String(row.getCell(1).value)] = row.getCell(2).value
    })
    expect(info).toMatchObject({ Client: 'Cliente A', Environment: 'Producción', Range: 'now-24h' })
  })

  /** Filas [etiqueta, valor] de la hoja Info del XLSX escrito. */
  async function infoRows(): Promise<[string, unknown][]> {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load([...written.values()][0] as unknown as ArrayBuffer)
    const rows: [string, unknown][] = []
    workbook.getWorksheet('Info')?.eachRow((row) => {
      rows.push([String(row.getCell(1).value), row.getCell(2).value])
    })
    return rows
  }

  it('AUD-13: resolution → fila propia «Resolución», antes de los Aviso', async () => {
    await call(
      build(dir),
      'export:table',
      table('xlsx', {
        resolution: '10m',
        warnings: ['m1: la API ha devuelto solo parte de los puntos']
      })
    )
    const rows = await infoRows()
    expect(rows.filter(([label]) => label === 'Resolución')).toEqual([['Resolución', '10m']])
    const labels = rows.map(([label]) => label)
    expect(labels.indexOf('Resolución')).toBeLessThan(labels.indexOf('Aviso'))
  })

  it('AUD-13: sin resolution no hay fila', async () => {
    await call(build(dir), 'export:table', table('xlsx'))
    expect((await infoRows()).some(([label]) => label === 'Resolución')).toBe(false)
  })

  it('AUD-13: con xlsxLabels.resolution usa esa etiqueta', async () => {
    const xlsxLabels = {
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
      to: 'To',
      resolution: 'Resolution'
    }
    await call(build(dir), 'export:table', table('xlsx', { xlsxLabels, resolution: '1h' }))
    expect((await infoRows()).filter(([label]) => label === 'Resolution')).toEqual([
      ['Resolution', '1h']
    ])
  })

  it.each([
    ['vacía', ''],
    ['de 21 caracteres', 'x'.repeat(21)],
    ['numérica', 5]
  ])('AUD-13: resolution %s → INVALID_INPUT', async (_case, resolution) => {
    expect(await call(build(dir), 'export:table', table('xlsx', { resolution }))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
    expect(written.size).toBe(0)
  })

  it('AUD-13: el CSV no lleva la resolución', async () => {
    await call(build(dir), 'export:table', table('csv', { resolution: '10m' }))
    const text = [...written.values()][0]?.toString('utf8') ?? ''
    expect(text).not.toContain('Resolución')
  })

  it('clusterFilter → fila propia «Filtro de clúster» con los valores unidos, antes de descartados y Aviso', async () => {
    await call(
      build(dir),
      'export:table',
      table('xlsx', {
        clusterFilter: ['cluster-sur', 'cluster-norte'],
        invalidCount: 1,
        warnings: ['Aviso de la API']
      })
    )
    const rows = await infoRows()
    expect(rows.filter(([label]) => label === 'Filtro de clúster')).toEqual([
      ['Filtro de clúster', 'cluster-sur | cluster-norte']
    ])
    const labels = rows.map(([label]) => label)
    expect(labels.indexOf('Filtro de clúster')).toBeLessThan(
      labels.indexOf('Elementos descartados')
    )
    expect(labels.indexOf('Filtro de clúster')).toBeLessThan(labels.indexOf('Aviso'))
  })

  it('sin clusterFilter no hay fila de filtro', async () => {
    await call(build(dir), 'export:table', table('xlsx'))
    expect((await infoRows()).some(([label]) => label === 'Filtro de clúster')).toBe(false)
  })

  it('con xlsxLabels.clusterFilter usa esa etiqueta', async () => {
    const xlsxLabels = {
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
      to: 'To',
      clusterFilter: 'Cluster filter'
    }
    await call(build(dir), 'export:table', table('xlsx', { xlsxLabels, clusterFilter: ['c1'] }))
    expect((await infoRows()).filter(([label]) => label === 'Cluster filter')).toEqual([
      ['Cluster filter', 'c1']
    ])
  })

  it.each([
    ['vacío', []],
    ['con un valor de 201 caracteres', ['x'.repeat(201)]],
    ['con un valor vacío', ['']],
    ['con 101 valores', Array.from({ length: 101 }, (_, i) => `c${i}`)]
  ])('clusterFilter %s → INVALID_INPUT', async (_case, clusterFilter) => {
    expect(await call(build(dir), 'export:table', table('xlsx', { clusterFilter }))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
    expect(written.size).toBe(0)
  })

  it('CSV con clusterFilter: sin filas de contexto (el CSV no lleva Info)', async () => {
    await call(build(dir), 'export:table', table('csv', { clusterFilter: ['cluster-sur'] }))
    const text = [...written.values()][0]?.toString('utf8') ?? ''
    expect(text).not.toContain('Filtro de clúster')
    expect(text).not.toContain('cluster-sur')
  })

  it('AUD-08: invalidCount > 0 → fila propia «Elementos descartados» con el número, antes de los Aviso', async () => {
    await call(
      build(dir),
      'export:table',
      table('xlsx', { invalidCount: 2, warnings: ['Aviso de la API'] })
    )
    const rows = await infoRows()
    const invalid = rows.filter(([label]) => label === 'Elementos descartados')
    expect(invalid).toEqual([['Elementos descartados', 2]])
    expect(typeof invalid[0]?.[1]).toBe('number')
    // Los Aviso son solo los de Dynatrace.
    expect(rows.filter(([label]) => label === 'Aviso')).toEqual([['Aviso', 'Aviso de la API']])
    const labels = rows.map(([label]) => label)
    expect(labels.indexOf('Elementos descartados')).toBeLessThan(labels.indexOf('Aviso'))
  })

  it.each([
    ['0', { invalidCount: 0 }],
    ['ausente', {}]
  ])('AUD-08: invalidCount %s → sin fila de descartados', async (_case, extra) => {
    await call(build(dir), 'export:table', table('xlsx', extra))
    expect((await infoRows()).some(([label]) => label === 'Elementos descartados')).toBe(false)
  })

  it('AUD-08: con xlsxLabels.invalidItems usa esa etiqueta', async () => {
    const xlsxLabels = {
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
      to: 'To',
      invalidItems: 'Discarded items'
    }
    await call(build(dir), 'export:table', table('xlsx', { xlsxLabels, invalidCount: 3 }))
    expect((await infoRows()).filter(([label]) => label === 'Discarded items')).toEqual([
      ['Discarded items', 3]
    ])
  })

  it.each([
    ['negativo', -1],
    ['con decimales', 1.5],
    ['texto', '2']
  ])('AUD-08: invalidCount %s → INVALID_INPUT', async (_case, invalidCount) => {
    expect(await call(build(dir), 'export:table', table('xlsx', { invalidCount }))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
    expect(written.size).toBe(0)
  })

  it('AUD-08: los warnings van a la hoja Info, una fila por aviso, con la etiqueta Aviso', async () => {
    await call(
      build(dir),
      'export:table',
      table('xlsx', {
        warnings: ['1 elemento no se pudo leer y no se muestra.', 'Aviso de la API']
      })
    )
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load([...written.values()][0] as unknown as ArrayBuffer)
    const rows: [string, string][] = []
    workbook.getWorksheet('Info')?.eachRow((row) => {
      rows.push([String(row.getCell(1).value), String(row.getCell(2).value)])
    })
    const warnings = rows.filter(([label]) => label === 'Aviso').map(([, value]) => value)
    expect(warnings).toEqual(['1 elemento no se pudo leer y no se muestra.', 'Aviso de la API'])
  })

  it('AUD-08: con xlsxLabels.warning usa esa etiqueta', async () => {
    const xlsxLabels = {
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
      to: 'To',
      warning: 'Warning'
    }
    await call(build(dir), 'export:table', table('xlsx', { xlsxLabels, warnings: ['W'] }))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load([...written.values()][0] as unknown as ArrayBuffer)
    let found = false
    workbook.getWorksheet('Info')?.eachRow((row) => {
      if (row.getCell(1).value === 'Warning' && row.getCell(2).value === 'W') found = true
    })
    expect(found).toBe(true)
  })

  it.each([
    ['más de 20 avisos', Array.from({ length: 21 }, (_, i) => `A${i}`)],
    ['un aviso de más de 500 caracteres', ['x'.repeat(501)]]
  ])('AUD-08: rechaza %s', async (_case, warnings) => {
    expect(await call(build(dir), 'export:table', table('xlsx', { warnings }))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
    expect(written.size).toBe(0)
  })

  it.each([
    ['vacía', ''],
    ['de más de 60 caracteres', 'x'.repeat(61)]
  ])('rechaza una etiqueta %s', async (_case, value) => {
    const xlsxLabels = {
      dataSheet: value,
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
    expect(await call(build(dir), 'export:table', table('xlsx', { xlsxLabels }))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
    expect(written.size).toBe(0)
  })

  it.each([
    ['txt', '.txt'],
    ['txt-tabs', '.txt']
  ])('formato %s → fichero %s', async (format, ext) => {
    const result = await call(build(dir), 'export:table', table(format))
    expect((result.data as { fileName: string }).fileName.endsWith(ext)).toBe(true)
    const text = [...written.values()][0]?.toString('utf8') ?? ''
    expect(text.includes('\t')).toBe(format === 'txt-tabs')
  })
})

describe('export:table con diálogo', () => {
  it('propone el nombre en la última carpeta, guarda donde se elija y recuerda la carpeta', async () => {
    const handlers = build(null)
    const first = join('D:', 'informes', 'mi.csv')
    dialogAnswer = first
    expect(await call(handlers, 'export:table', table('csv'))).toMatchObject({
      ok: true,
      data: { status: 'saved' }
    })

    const [defaultPath, kind] = chooseSaveFile.mock.calls[0] as [string, string]
    expect(defaultPath.endsWith(`Cliente_A_Producción_problems_${STAMP}.csv`)).toBe(true)
    expect(kind).toBe('csv')
    expect(written.has(first)).toBe(true)
    expect(settings.get('lastExportDir')).toBe(dirname(first))

    dialogAnswer = null
    expect(await call(handlers, 'export:table', table('xlsx'))).toEqual({
      ok: true,
      data: { status: 'cancelled' }
    })
    const [secondDefault, secondKind] = chooseSaveFile.mock.calls[1] as [string, string]
    expect(secondDefault).toBe(join(dirname(first), `Cliente_A_Producción_problems_${STAMP}.xlsx`))
    expect(secondKind).toBe('xlsx')
    expect(written.size).toBe(1)
  })
})

describe('export:table: límites de entrada', () => {
  it.each([
    ['sin columnas', { columns: [] }],
    [
      'más de 100 columnas',
      {
        columns: Array.from({ length: 101 }, (_, i) => ({
          key: `c${i}`,
          header: `c${i}`,
          type: 'string'
        }))
      }
    ],
    ['más de 100.000 filas', { rows: Array.from({ length: 100_001 }, () => ({ displayId: 'x' })) }],
    ['un formato desconocido', { format: 'pdf' }],
    ['un módulo desconocido', { module: 'topology' }]
  ])('rechaza %s', async (_case, change) => {
    const result = await call(build(join('C:', 'x')), 'export:table', table('csv', change))
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(written.size).toBe(0)
  })

  it('rechaza más de 20 MB de datos', async () => {
    const big = 'x'.repeat(100_000)
    const result = await call(
      build(join('C:', 'x')),
      'export:table',
      table('csv', { rows: Array.from({ length: 220 }, () => ({ displayId: 'P', title: big })) })
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(written.size).toBe(0)
  })
})

describe('export:getSettings y export:setSettings', () => {
  it('por defecto ";" y pie activado; se cambian por separado', async () => {
    const handlers = build(null)
    expect(await call(handlers, 'export:getSettings')).toEqual({
      ok: true,
      data: { csvSeparator: ';', captureFooter: true }
    })
    expect(await call(handlers, 'export:setSettings', { captureFooter: false })).toEqual({
      ok: true,
      data: { csvSeparator: ';', captureFooter: false }
    })
    expect(await call(handlers, 'export:setSettings', { csvSeparator: ',' })).toEqual({
      ok: true,
      data: { csvSeparator: ',', captureFooter: false }
    })
    expect(await call(handlers, 'export:setSettings', { csvSeparator: '|' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
  })
})

describe('capture:image', () => {
  it('copia el PNG al portapapeles tal cual', async () => {
    const result = await call(build(null), 'capture:image', {
      environmentId: envId,
      module: 'problems',
      dataUrl: PNG_DATA_URL,
      action: 'clipboard'
    })
    expect(result).toEqual({ ok: true, data: { status: 'copied' } })
    expect(clipboardImages).toHaveLength(1)
    expect(clipboardImages[0]?.equals(Buffer.from(PNG_BASE64, 'base64'))).toBe(true)
  })

  it('guarda el PNG con el nombre acordado; sin entorno usa "vigia"', async () => {
    const dir = join('C:', 'capturas')
    const handlers = build(dir)
    expect(
      await call(handlers, 'capture:image', {
        environmentId: envId,
        module: 'metrics',
        dataUrl: PNG_DATA_URL,
        action: 'save'
      })
    ).toMatchObject({ ok: true, data: { status: 'saved' } })
    expect(
      await call(handlers, 'capture:image', {
        module: 'home',
        dataUrl: PNG_DATA_URL,
        action: 'save'
      })
    ).toMatchObject({ ok: true, data: { status: 'saved' } })

    expect([...written.keys()].sort()).toEqual(
      [
        join(dir, `Cliente_A_Producción_metrics_${STAMP}.png`),
        join(dir, `vigia_vigia_home_${STAMP}.png`)
      ].sort()
    )
  })

  it.each([
    ['otro tipo de imagen', `data:image/jpeg;base64,${PNG_BASE64}`],
    ['sin prefijo', PNG_BASE64],
    [
      'prefijo PNG pero bytes que no son PNG',
      `data:image/png;base64,${Buffer.from('<svg/>').toString('base64')}`
    ],
    ['más de 15 MB', `data:image/png;base64,${PNG_BASE64}${'A'.repeat(21 * 1024 * 1024)}`]
  ])('rechaza %s', async (_case, dataUrl) => {
    const result = await call(build(join('C:', 'x')), 'capture:image', {
      module: 'problems',
      dataUrl,
      action: 'save'
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(written.size).toBe(0)
    expect(clipboardImages).toHaveLength(0)
  })
})

describe('capture:region', () => {
  it('captura el rectángulo de la ventana y lo copia o lo guarda', async () => {
    const handlers = build(join('C:', 'capturas'))
    const rect = { x: 10, y: 20, width: 300, height: 200 }
    expect(
      await call(handlers, 'capture:region', {
        environmentId: envId,
        module: 'home',
        rect,
        action: 'clipboard'
      })
    ).toEqual({
      ok: true,
      data: { status: 'copied' }
    })
    expect(capturePage).toHaveBeenCalledWith(rect)
    expect(clipboardImages).toHaveLength(1)

    expect(
      await call(handlers, 'capture:region', {
        environmentId: envId,
        module: 'home',
        rect,
        action: 'save'
      })
    ).toMatchObject({
      ok: true,
      data: { status: 'saved' }
    })
    expect([...written.keys()][0]?.endsWith('.png')).toBe(true)
  })

  it.each([
    ['que se sale por la derecha', { x: 700, y: 0, width: 200, height: 100 }],
    ['que se sale por abajo', { x: 0, y: 500, width: 100, height: 200 }],
    ['con coordenadas negativas', { x: -1, y: 0, width: 10, height: 10 }],
    ['con decimales', { x: 0.5, y: 0, width: 10, height: 10 }],
    ['con y negativa', { x: 0, y: -5, width: 10, height: 10 }],
    ['de ancho 0', { x: 0, y: 0, width: 0, height: 10 }],
    ['de alto 0', { x: 0, y: 0, width: 10, height: 0 }],
    ['con un tamaño no entero', { x: 0, y: 0, width: 10, height: 10.5 }]
  ])('rechaza un rectángulo %s sin capturar', async (_case, rect) => {
    const result = await call(build(null), 'capture:region', {
      module: 'home',
      rect,
      action: 'clipboard'
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(capturePage).not.toHaveBeenCalled()
  })
})

describe('AUD-14: fileName es el del fichero escrito', () => {
  const capture = (channel: 'capture:image' | 'capture:region'): Record<string, unknown> =>
    channel === 'capture:image'
      ? { environmentId: envId, module: 'metrics', dataUrl: PNG_DATA_URL, action: 'save' }
      : {
          environmentId: envId,
          module: 'home',
          rect: { x: 0, y: 0, width: 10, height: 10 },
          action: 'save'
        }

  it('con diálogo: export:table devuelve el nombre ELEGIDO, no el propuesto', async () => {
    dialogAnswer = join('D:', 'informes', 'mi-informe.xlsx')
    expect(await call(build(null), 'export:table', table('xlsx'))).toEqual({
      ok: true,
      data: { status: 'saved', fileName: 'mi-informe.xlsx' }
    })
    expect(written.has(dialogAnswer)).toBe(true)
  })

  it.each(['capture:image', 'capture:region'] as const)(
    'con diálogo: %s devuelve el nombre elegido',
    async (channel) => {
      dialogAnswer = join('D:', 'capturas', 'pantalla propia.png')
      expect(await call(build(null), channel, capture(channel))).toEqual({
        ok: true,
        data: { status: 'saved', fileName: 'pantalla propia.png' }
      })
      expect(written.has(dialogAnswer)).toBe(true)
    }
  )

  it.each(['capture:image', 'capture:region'] as const)(
    'con diálogo cancelado: %s → cancelled sin fileName',
    async (channel) => {
      dialogAnswer = null
      expect(await call(build(null), channel, capture(channel))).toEqual({
        ok: true,
        data: { status: 'cancelled' }
      })
      expect(written.size).toBe(0)
    }
  )

  it('con la carpeta fija: el nombre escrito, con -2 y -3 si ya existe', async () => {
    const dir = join('C:', 'capturas')
    const handlers = createExportHandlers({
      repo: createTenantRepository(db),
      settings,
      exportDir: dir,
      dialogs: { chooseSaveFile },
      writeFile: async (path: string, data: Buffer) => {
        written.set(path, data)
      },
      fileExists: (path: string) => written.has(path),
      clipboard: { writeImage: (png: Buffer) => clipboardImages.push(png) },
      window: { size: () => ({ width: 800, height: 600 }), capturePage },
      now: () => NOW,
      timeZone: () => 'Europe/Madrid'
    } as unknown as Parameters<typeof createExportHandlers>[0])
    const base = `Cliente_A_Producción_metrics_${STAMP}`
    const names: unknown[] = []
    for (let i = 0; i < 3; i++) {
      const result = await call(handlers, 'capture:image', capture('capture:image'))
      names.push((result.data as { fileName?: string }).fileName)
    }
    expect(names).toEqual([`${base}.png`, `${base}-2.png`, `${base}-3.png`])
    expect([...written.keys()].sort()).toEqual(names.map((n) => join(dir, String(n))).sort())
    expect(chooseSaveFile).not.toHaveBeenCalled()
  })

  it('al portapapeles, sin fileName', async () => {
    const result = await call(build(null), 'capture:image', {
      ...capture('capture:image'),
      action: 'clipboard'
    })
    expect(result).toEqual({ ok: true, data: { status: 'copied' } })
  })
})

describe('AUD-14: loadedAt fija Desde y Hasta a cuando se cargaron los datos', () => {
  const dir = join('C:', 'exportaciones')
  const HOUR = 3600_000

  async function info(extra: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await call(build(dir), 'export:table', table('xlsx', extra))
    expect(result.ok, JSON.stringify(result)).toBe(true)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load([...written.values()][0] as unknown as ArrayBuffer)
    const values: Record<string, unknown> = {}
    workbook.getWorksheet('Info')?.eachRow((row) => {
      values[String(row.getCell(1).value)] = row.getCell(2).value
    })
    return values
  }

  it('datos de hace 6 h con rango 2h: Desde = loadedAt − 2 h, Hasta = loadedAt; Exportado = ahora', async () => {
    const loadedAt = NOW.getTime() - 6 * HOUR
    const values = await info({ timeRange: '2h', loadedAt })
    expect((values['Hasta'] as Date).getTime()).toBe(loadedAt)
    expect((values['Desde'] as Date).getTime()).toBe(loadedAt - 2 * HOUR)
    expect((values['Exportado'] as Date).getTime()).toBe(NOW.getTime())
    expect(values['Rango']).toBe('now-2h')
  })

  it('sin loadedAt, como antes: relativas a la hora de exportar', async () => {
    const values = await info({ timeRange: '2h' })
    expect((values['Hasta'] as Date).getTime()).toBe(NOW.getTime())
    expect((values['Desde'] as Date).getTime()).toBe(NOW.getTime() - 2 * HOUR)
  })

  it('un rango personalizado no depende de loadedAt', async () => {
    const from = Date.UTC(2026, 9, 1, 8, 0)
    const to = Date.UTC(2026, 9, 1, 10, 0)
    const values = await info({
      timeRange: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      loadedAt: NOW.getTime() - 6 * HOUR
    })
    expect((values['Desde'] as Date).getTime()).toBe(from)
    expect((values['Hasta'] as Date).getTime()).toBe(to)
  })

  it.each([
    ['0', 0],
    ['negativo', -1],
    ['con decimales', 1.5],
    ['texto', '1700000000000']
  ])('loadedAt %s → INVALID_INPUT sin escribir', async (_case, loadedAt) => {
    expect(
      await call(build(dir), 'export:table', table('xlsx', { timeRange: '2h', loadedAt }))
    ).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(written.size).toBe(0)
  })
})

describe('todos los canales de exportación', () => {
  it('existen exactamente los 5 canales', () => {
    expect(Object.keys(build(null)).sort()).toEqual([
      'capture:image',
      'capture:region',
      'export:getSettings',
      'export:setSettings',
      'export:table'
    ])
  })
})
