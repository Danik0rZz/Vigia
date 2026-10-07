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
      {/* Con poco ancho (hasta 960 px, el mínimo de la ventana), lo que se recorta es
          "Cliente › Entorno" (también está en el selector de entorno): la sección y el
          detalle no encogen y se ven siempre, para que el enlace de la sección se pueda pulsar
          (ficha 0005). El tramo del entorno tiene ancho 0 y crece hasta su contenido, así no
          cuenta en el mínimo de la ruta (min-w-fit), que es solo la sección y el detalle. */}
      <nav
        aria-label={t('topbar.breadcrumb')}
        className="flex min-w-fit flex-1 items-center gap-1.5 whitespace-nowrap"
      >
        {active !== null && (
          <span className="flex w-0 max-w-max grow items-center gap-1.5 overflow-hidden">
            <span className="truncate text-muted-foreground">{active.client.name}</span>
            <span className="shrink-0 text-muted-foreground">{SEPARATOR}</span>
            <span className="truncate text-muted-foreground">{active.label}</span>
            <EnvTypeBadge type={active.environment.type} />
            <span className="shrink-0 text-muted-foreground">{SEPARATOR}</span>
          </span>
        )}
        {current !== undefined && (
          <span className="shrink-0 font-medium" aria-current="page">
            {t(current.labelKey)}
          </span>
        )}
        {parent !== undefined && (
          <>
            <Link
              to={parent.path}
              data-testid="breadcrumb-section"
              className="app-no-drag shrink-0 text-muted-foreground hover:text-foreground hover:underline"
            >
              {t(parent.labelKey)}
            </Link>
            {detail !== null && (
              <>
                <span className="shrink-0 text-muted-foreground">{SEPARATOR}</span>
                <span
                  data-testid="breadcrumb-detail"
                  className="shrink-0 font-medium tabular-nums"
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

      {/* Por debajo de 1280 px solo el icono: deja sitio a la ruta. */}
      <button
        type="button"
        onClick={onOpenPalette}
        title={t('topbar.search')}
        className={iconButton}
      >
        <Search aria-hidden="true" className="size-4" />
        <span className="sr-only xl:not-sr-only">{t('topbar.search')}</span>
        <kbd className="hidden rounded border border-border px-1 text-[11px] xl:inline">
          {t('topbar.shortcut')}
        </kbd>
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
