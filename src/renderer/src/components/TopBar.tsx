import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { Languages, Moon, Search, Sun } from 'lucide-react'
import { NAV_SECTIONS } from '../app/navigation'
import { usePreferences } from '../app/preferences'
import { useResolvedTheme } from '../app/theme'

const iconButton =
  'app-no-drag flex h-7 items-center gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-hover hover:text-foreground'

/** Barra superior: ruta de la sección, búsqueda (Ctrl+K) y cambio rápido de tema e idioma. */
export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }): JSX.Element {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const theme = useResolvedTheme()
  const setTheme = usePreferences((state) => state.setTheme)
  const language = usePreferences((state) => state.language)
  const setLanguage = usePreferences((state) => state.setLanguage)

  const current = NAV_SECTIONS.find((section) => section.path === pathname)
  const ThemeIcon = theme === 'dark' ? Sun : Moon

  return (
    <header className="app-drag titlebar-inset flex h-12 shrink-0 items-center gap-2 pl-4">
      <nav aria-label={t('topbar.breadcrumb')} className="min-w-0 flex-1 truncate">
        {current !== undefined && (
          <span className="font-medium" aria-current="page">
            {t(current.labelKey)}
          </span>
        )}
      </nav>

      <button type="button" onClick={onOpenPalette} className={iconButton}>
        <Search aria-hidden="true" className="size-4" />
        <span>{t('topbar.search')}</span>
        <kbd className="rounded border border-border px-1 text-[11px]">{t('topbar.shortcut')}</kbd>
      </button>

      <button
        type="button"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label={theme === 'dark' ? t('topbar.themeToLight') : t('topbar.themeToDark')}
        title={theme === 'dark' ? t('topbar.themeToLight') : t('topbar.themeToDark')}
        className={iconButton}
      >
        <ThemeIcon aria-hidden="true" className="size-4" />
      </button>

      <button
        type="button"
        onClick={() => setLanguage(language === 'es' ? 'en' : 'es')}
        aria-label={t('topbar.language')}
        title={t('topbar.language')}
        className={iconButton}
      >
        <Languages aria-hidden="true" className="size-4" />
        <span className="text-xs font-medium">{t('topbar.languageShort')}</span>
      </button>
    </header>
  )
}
