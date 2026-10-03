import { useState, type JSX, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import * as Popover from '@radix-ui/react-popover'
import { Camera, Copy, Download } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { ExportColumn, ExportModule, ExportRow, XlsxLabels } from '@shared/modules'
import type { TimeRangeValue } from '@shared/time-range'
import { environmentPath, useActiveEnvironment } from '../data/tenants'
import { useExportSettings } from '../data/modules'
import { invoke } from '../lib/ipc'
import { BUTTON_ICON } from './styles'

type Action = 'csv' | 'xlsx' | 'txt' | 'txt-tabs' | 'clipboard' | 'save'

export interface ExportTable {
  columns: ExportColumn[]
  rows: ExportRow[]
  query?: string | undefined
  timeRange?: TimeRangeValue | undefined
  /** Nota para la hoja Info del XLSX, ya traducida. */
  note?: string | undefined
}

/** Etiquetas del XLSX (hojas e Info) en el idioma de la interfaz. */
function xlsxLabels(t: TFunction): XlsxLabels {
  const keys = [
    'dataSheet',
    'infoSheet',
    'client',
    'environment',
    'module',
    'query',
    'exported',
    'timeZone',
    'range',
    'from',
    'to',
    'note'
  ] as const
  return Object.fromEntries(keys.map((key) => [key, t(`export.xlsxLabels.${key}`)])) as XlsxLabels
}

/** Alto del pie de las capturas, en píxeles de la imagen (a doble resolución). */
const FOOTER_HEIGHT = 48

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('imagen'))
    image.src = dataUrl
  })
}

/** Añade debajo de la imagen una franja con "Cliente › Entorno · fecha" sobre fondo sólido. */
async function withFooter(dataUrl: string, text: string): Promise<string> {
  const image = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height + FOOTER_HEIGHT
  const context = canvas.getContext('2d')
  if (context === null) return dataUrl
  const style = getComputedStyle(document.documentElement)
  context.fillStyle = style.getPropertyValue('--background').trim()
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0)
  context.fillStyle = style.getPropertyValue('--muted-foreground').trim()
  context.font = `${FOOTER_HEIGHT / 2.4}px "Segoe UI", system-ui, sans-serif`
  context.textBaseline = 'middle'
  context.fillText(text, 24, image.height + FOOTER_HEIGHT / 2)
  return canvas.toDataURL('image/png')
}

/**
 * Menú único de exportación y captura de tablas y gráficos. Las tablas se
 * exportan (CSV, XLSX, TXT); los gráficos, además, se capturan como PNG. Un
 * elemento sin imagen propia se captura por su zona de la ventana.
 */
export function ExportMenu({
  target,
  module,
  table,
  image,
  element
}: {
  /** data-testid de la tabla o el gráfico al que pertenece. */
  target: string
  module: ExportModule
  table?: ExportTable | undefined
  /** PNG del gráfico (doble resolución, fondo sólido). */
  image?: (() => string | null) | undefined
  /** Elemento a capturar si no hay `image`. */
  element?: RefObject<HTMLElement | null> | undefined
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const active = useActiveEnvironment()
  const settings = useExportSettings()
  const environmentId = active?.environment.id

  async function capture(action: 'clipboard' | 'save'): Promise<{ status: string }> {
    const dataUrl = image?.() ?? null
    if (dataUrl !== null) {
      const footer =
        settings.captureFooter && active !== null
          ? `${environmentPath(active.client, active.label)} · ${new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`
          : null
      return invoke('capture:image', {
        ...(environmentId === undefined ? {} : { environmentId }),
        module,
        dataUrl: footer === null ? dataUrl : await withFooter(dataUrl, footer),
        action
      })
    }
    const box = element?.current?.getBoundingClientRect()
    if (box === undefined) throw new Error('Nada que capturar')
    return invoke('capture:region', {
      ...(environmentId === undefined ? {} : { environmentId }),
      module,
      rect: {
        x: Math.max(0, Math.floor(box.x)),
        y: Math.max(0, Math.floor(box.y)),
        width: Math.max(1, Math.floor(Math.min(box.width, window.innerWidth - box.x))),
        height: Math.max(1, Math.floor(Math.min(box.height, window.innerHeight - box.y)))
      },
      action
    })
  }

  async function run(action: Action): Promise<void> {
    setOpen(false)
    setNotice(null)
    try {
      if (action === 'clipboard' || action === 'save') {
        const result = await capture(action)
        if (result.status === 'copied') setNotice(t('export.copied'))
        else if (result.status === 'saved') setNotice(t('export.saved', { file: '' }).trim())
        return
      }
      if (table === undefined || environmentId === undefined) return
      const result = await invoke('export:table', {
        environmentId,
        module,
        format: action,
        columns: table.columns,
        rows: table.rows,
        ...(table.query === undefined ? {} : { query: table.query }),
        ...(table.timeRange === undefined ? {} : { timeRange: table.timeRange }),
        ...(table.note === undefined ? {} : { note: table.note }),
        // Las etiquetas del XLSX las traduce la interfaz, como las cabeceras.
        ...(action === 'xlsx' ? { xlsxLabels: xlsxLabels(t) } : {})
      })
      if (result.status === 'saved') setNotice(t('export.saved', { file: result.fileName ?? '' }))
    } catch {
      setNotice(t('export.failed'))
    }
  }

  const option = (
    testId: string,
    action: Action,
    label: string,
    Icon: typeof Download
  ): JSX.Element => (
    <button
      type="button"
      data-testid={testId}
      onClick={() => void run(action)}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-hover hover:text-foreground"
    >
      <Icon aria-hidden="true" className="size-4" />
      {label}
    </button>
  )

  return (
    <div className="flex items-center gap-2">
      {notice !== null && (
        <span role="status" className="max-w-60 truncate text-xs text-muted-foreground">
          {notice}
        </span>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          data-testid="export-menu"
          data-export-target={target}
          aria-label={t('export.menu')}
          title={t('export.menu')}
          className={BUTTON_ICON}
        >
          <Download aria-hidden="true" className="size-4" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={4}
            className="glass z-50 grid w-60 gap-0.5 rounded-lg p-1"
          >
            {table !== undefined && (
              <>
                {option('export-csv', 'csv', t('export.csv'), Download)}
                {option('export-xlsx', 'xlsx', t('export.xlsx'), Download)}
                {option('export-txt', 'txt', t('export.txt'), Download)}
                {option('export-txt-tabs', 'txt-tabs', t('export.txtTabs'), Download)}
              </>
            )}
            {option('capture-copy', 'clipboard', t('export.copy'), Copy)}
            {option('capture-save', 'save', t('export.savePng'), Camera)}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
