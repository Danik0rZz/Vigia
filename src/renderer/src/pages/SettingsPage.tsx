import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThemePreference } from '@shared/ipc'
import { usePreferences, type Language } from '../app/preferences'
import { OptionGroup } from '../components/OptionGroup'
import { PageHeader } from '../components/PageHeader'
import { ExportSettingsSection } from '../settings/ExportSettingsSection'
import { TenantsSection } from '../settings/TenantsSection'

/** Ajustes: tema, idioma, y clientes y entornos con sus credenciales. */
export function SettingsPage(): JSX.Element {
  const { t } = useTranslation()
  const theme = usePreferences((state) => state.theme)
  const setTheme = usePreferences((state) => state.setTheme)
  const language = usePreferences((state) => state.language)
  const setLanguage = usePreferences((state) => state.setLanguage)

  const themes: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: t('settings.themeLight') },
    { value: 'dark', label: t('settings.themeDark') },
    { value: 'system', label: t('settings.themeSystem') }
  ]
  const languages: { value: Language; label: string }[] = [
    { value: 'es', label: t('settings.languageEs') },
    { value: 'en', label: t('settings.languageEn') }
  ]

  return (
    <>
      <PageHeader title={t('nav.settings')} />
      <div className="grid max-w-2xl gap-4">
        <section className="glass grid gap-3 rounded-xl p-5" aria-labelledby="settings-theme">
          <h2 id="settings-theme" className="font-semibold">
            {t('settings.theme')}
          </h2>
          <OptionGroup
            value={theme}
            options={themes}
            onChange={setTheme}
            labelledBy="settings-theme"
            testIdPrefix="theme"
          />
        </section>
        <section className="glass grid gap-3 rounded-xl p-5" aria-labelledby="settings-language">
          <h2 id="settings-language" className="font-semibold">
            {t('settings.language')}
          </h2>
          <OptionGroup
            value={language}
            options={languages}
            onChange={setLanguage}
            labelledBy="settings-language"
            testIdPrefix="language"
          />
        </section>
        <ExportSettingsSection />
        <TenantsSection />
      </div>
    </>
  )
}
