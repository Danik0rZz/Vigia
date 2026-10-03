import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ExportSettings } from '@shared/modules'
import { OptionGroup } from '../components/OptionGroup'
import { useExportSettings } from '../data/modules'
import { invoke } from '../lib/ipc'

/** Ajustes › Exportación: separador del CSV y pie de las capturas (se guardan en main). */
export function ExportSettingsSection(): JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useExportSettings()
  const update = useMutation({
    mutationFn: (change: Partial<ExportSettings>) => invoke('export:setSettings', change),
    onSuccess: (data) => queryClient.setQueryData(['exportSettings'], data)
  })

  return (
    <section className="glass grid gap-4 rounded-xl p-5" aria-labelledby="export-settings-title">
      <h2 id="export-settings-title" className="font-semibold">
        {t('exportSettings.title')}
      </h2>
      <div className="grid gap-2">
        <h3 id="csv-separator-title" className="text-sm text-muted-foreground">
          {t('exportSettings.csvSeparator')}
        </h3>
        <OptionGroup
          value={settings.csvSeparator === ',' ? 'comma' : 'semicolon'}
          options={[
            { value: 'semicolon', label: t('exportSettings.semicolon') },
            { value: 'comma', label: t('exportSettings.comma') }
          ]}
          onChange={(value) => update.mutate({ csvSeparator: value === 'comma' ? ',' : ';' })}
          labelledBy="csv-separator-title"
          testIdPrefix="csv-separator"
        />
      </div>
      <div className="grid gap-2">
        <h3 id="capture-footer-title" className="text-sm text-muted-foreground">
          {t('exportSettings.captureFooter')}
        </h3>
        <OptionGroup
          value={settings.captureFooter ? 'on' : 'off'}
          options={[
            { value: 'on', label: t('exportSettings.footerOn') },
            { value: 'off', label: t('exportSettings.footerOff') }
          ]}
          onChange={(value) => update.mutate({ captureFooter: value === 'on' })}
          labelledBy="capture-footer-title"
          testIdPrefix="capture-footer"
        />
      </div>
    </section>
  )
}
