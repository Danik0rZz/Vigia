import { dirname, join } from 'node:path'
import {
  MAX_CAPTURE_BYTES,
  MAX_EXPORT_JSON_BYTES,
  type ExportModule,
  type ExportSettings
} from '@shared/modules'
import { timeRangeToDates, timeRangeToDt } from '@shared/time-range'
import { DomainError } from '../../errors'
import { buildCsv, buildTxt, buildXlsx, exportFileName } from '../../export'
import type { SettingsStore } from '../../settings/store'
import type { TenantRepository } from '../../tenants/repository'
import type { IpcImplementations } from '../handler'

type ExportChannels =
  'export:table' | 'export:getSettings' | 'export:setSettings' | 'capture:image' | 'capture:region'

export type SaveKind = 'csv' | 'xlsx' | 'txt' | 'png'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ExportHandlerDeps {
  repo: TenantRepository
  settings: SettingsStore
  /** Carpeta fija sin diálogo (solo en pruebas, ver resolveExportDir); null = diálogo. */
  exportDir: string | null
  dialogs: { chooseSaveFile(defaultPath: string, kind: SaveKind): Promise<string | null> }
  writeFile(path: string, data: Buffer): Promise<void>
  /** Con la carpeta fija, para no sobrescribir un fichero del mismo minuto. */
  fileExists?(path: string): boolean
  clipboard: { writeImage(png: Buffer): void | Promise<void> }
  window: { size(): { width: number; height: number }; capturePage(rect: Rect): Promise<Buffer> }
  now(): Date
  timeZone(): string
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_PREFIX = 'data:image/png;base64,'

const SETTING_SEPARATOR = 'csvSeparator'
const SETTING_FOOTER = 'captureFooter'
const SETTING_LAST_DIR = 'lastExportDir'

/** Exportación de tablas y capturas: los ficheros los escribe siempre main. */
export function createExportHandlers(
  deps: ExportHandlerDeps
): Pick<IpcImplementations, ExportChannels> {
  const { settings } = deps

  function readSettings(): ExportSettings {
    return {
      csvSeparator: settings.get(SETTING_SEPARATOR) === ',' ? ',' : ';',
      captureFooter: settings.get(SETTING_FOOTER) !== 'false'
    }
  }

  /** Nombres de cliente y entorno para el fichero; sin entorno, "vigia". */
  function names(environmentId: string | undefined): { client: string; environment: string } {
    if (environmentId === undefined) return { client: 'vigia', environment: 'vigia' }
    const environment = deps.repo.getEnvironment(environmentId)
    const client = deps.repo
      .listClients()
      .find((candidate) => candidate.id === environment.clientId)
    return { client: client?.name ?? 'vigia', environment: environment.name }
  }

  /** Guarda en la carpeta fija o, con diálogo, donde elija el usuario (recordando la carpeta). */
  async function save(fileName: string, kind: SaveKind, data: Buffer): Promise<string | null> {
    if (deps.exportDir !== null) {
      const dir = deps.exportDir
      const dot = fileName.lastIndexOf('.')
      let name = fileName
      for (let n = 2; deps.fileExists?.(join(dir, name)) === true; n += 1) {
        name = `${fileName.slice(0, dot)}-${n}${fileName.slice(dot)}`
      }
      await deps.writeFile(join(dir, name), data)
      return name
    }
    const lastDir = settings.get(SETTING_LAST_DIR)
    const path = await deps.dialogs.chooseSaveFile(
      lastDir === null ? fileName : join(lastDir, fileName),
      kind
    )
    if (path === null) return null
    await deps.writeFile(path, data)
    settings.set(SETTING_LAST_DIR, dirname(path))
    return fileName
  }

  async function deliverPng(
    png: Buffer,
    action: 'clipboard' | 'save',
    environmentId: string | undefined,
    module: ExportModule
  ): Promise<{ status: 'copied' | 'saved' | 'cancelled' }> {
    if (action === 'clipboard') {
      await deps.clipboard.writeImage(png)
      return { status: 'copied' }
    }
    const fileName = exportFileName({
      ...names(environmentId),
      module,
      date: deps.now(),
      ext: 'png'
    })
    return (await save(fileName, 'png', png)) === null
      ? { status: 'cancelled' }
      : { status: 'saved' }
  }

  return {
    'export:table': async (input) => {
      if (JSON.stringify(input.rows).length > MAX_EXPORT_JSON_BYTES) {
        throw new DomainError('INVALID_INPUT', 'Demasiados datos para exportar.')
      }
      const now = deps.now()
      const { client, environment } = names(input.environmentId)
      const { csvSeparator } = readSettings()

      let data: Buffer
      let kind: SaveKind
      switch (input.format) {
        case 'csv':
          data = buildCsv(input.columns, input.rows, { separator: csvSeparator })
          kind = 'csv'
          break
        case 'txt':
        case 'txt-tabs':
          data = buildTxt(input.columns, input.rows, { tabs: input.format === 'txt-tabs' })
          kind = 'txt'
          break
        case 'xlsx': {
          const dates =
            input.timeRange === undefined ? undefined : timeRangeToDates(input.timeRange, now)
          data = await buildXlsx(
            input.columns,
            input.rows,
            {
              client,
              environment,
              module: input.module,
              query: input.query,
              exportedAt: now,
              timeZone: deps.timeZone(),
              range:
                input.timeRange === undefined ? undefined : timeRangeToDt(input.timeRange).from,
              from: dates?.from,
              to: dates?.to
            },
            { labels: input.xlsxLabels }
          )
          kind = 'xlsx'
          break
        }
      }

      const fileName = exportFileName({
        client,
        environment,
        module: input.module,
        date: now,
        ext: kind
      })
      const saved = await save(fileName, kind, data)
      return saved === null ? { status: 'cancelled' } : { status: 'saved', fileName: saved }
    },

    'export:getSettings': () => readSettings(),

    'export:setSettings': (input) => {
      if (input.csvSeparator !== undefined) settings.set(SETTING_SEPARATOR, input.csvSeparator)
      if (input.captureFooter !== undefined)
        settings.set(SETTING_FOOTER, String(input.captureFooter))
      return readSettings()
    },

    'capture:image': async ({ environmentId, module, dataUrl, action }) => {
      if (!dataUrl.startsWith(PNG_PREFIX)) {
        throw new DomainError('INVALID_INPUT', 'La captura tiene que ser un PNG.')
      }
      const png = Buffer.from(dataUrl.slice(PNG_PREFIX.length), 'base64')
      if (png.length > MAX_CAPTURE_BYTES || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new DomainError('INVALID_INPUT', 'La captura no es un PNG válido.')
      }
      return deliverPng(png, action, environmentId, module)
    },

    'capture:region': async ({ environmentId, module, rect, action }) => {
      const { width, height } = deps.window.size()
      if (rect.x + rect.width > width || rect.y + rect.height > height) {
        throw new DomainError('INVALID_INPUT', 'La zona a capturar se sale de la ventana.')
      }
      return deliverPng(await deps.window.capturePage(rect), action, environmentId, module)
    }
  }
}
