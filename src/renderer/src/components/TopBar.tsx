import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import { Languages, Moon, Search, Sun } from 'lucide-react'
import { NAV_SECTIONS } from '../app/navigation'
import { usePageCrumb } from '../app/page-crumb'
import { usePreferences } from '../app/preferences'
import { useResolvedTheme } from '../app/theme'
import { useActiveEnvironment } from '../data/tenants'
import { EnvSelector } from './EnvSelector'
import { EnvTypeBadge } from './EnvTypeBadge'
import { TimeRangeSelector } from './TimeRangeSelector'

/** Separador de la ruta; es un signo, no texto traducible. */
const SEPARATOR = '›'

const iconButton =
  'app-no-drag flex h-7 items-center gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-hover hover:text-foreground'

/**
 * Barra superior: ruta "Cliente › Entorno › Sección", selector de entorno, rango
 * temporal, búsqueda (Ctrl+K) y cambio rápido de tema e idioma.
 */
export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }): JSX.Element {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const theme = useResolvedTheme()
  const setTheme = usePreferences((state) => state.setTheme)
  const language = usePreferences((state) => state.language)
  const setLanguage = usePreferences((state) => state.setLanguage)

  const active = useActiveEnvironment()
  const current = NAV_SECTIONS.find((section) => section.path === pathname)
  // Una página dentro de una sección (/problems/:id): la sección es un enlace y
  // el último tramo lo pone la página.
  const parent =
    current === undefined
      ? NAV_SECTIONS.find(
          (section) => section.path !== '/' && pathname.startsWith(`${section.path}/`)
        )
      : undefined
  const detail = usePageCrumb((state) => state.detail)
  const ThemeIcon = theme === 'dark' ? Sun : Moon

  return (
    <header className="app-drag titlebar-inset flex h-12 shrink-0 items-center gap-2 pl-4">
      <nav
        aria-label={t('topbar.breadcrumb')}
        className="flex min-w-0 flex-1 items-center gap-1.5 truncate"
      >
        {active !== null && (
          <>
            <span className="text-muted-foreground">{active.client.name}</span>
            <span className="text-muted-foreground">{SEPARATOR}</span>
            <span className="text-muted-foreground">{active.label}</span>
            <EnvTypeBadge type={active.environment.type} />
            <span className="text-muted-foreground">{SEPARATOR}</span>
          </>
        )}
        {current !== undefined && (
          <span className="font-medium" aria-current="page">
            {t(current.labelKey)}
          </span>
        )}
        {parent !== undefined && (
          <>
            <Link
              to={parent.path}
              data-testid="breadcrumb-section"
              className="app-no-drag text-muted-foreground hover:text-foreground hover:underline"
            >
              {t(parent.labelKey)}
            </Link>
            {detail !== null && (
              <>
                <span className="text-muted-foreground">{SEPARATOR}</span>
                <span
                  data-testid="breadcrumb-detail"
                  className="font-medium tabular-nums"
                  aria-current="page"
                >
                  {detail}
                </span>
              </>
            )}
          </>
        )}
      </nav>

      <EnvSelector />
      <TimeRangeSelector />

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
