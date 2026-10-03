import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { APP_NAME } from '@shared/app'
import { AppIcon, NAV_GROUPS, NAV_SECTIONS, type NavSection } from '../app/navigation'
import { usePreferences } from '../app/preferences'
import { cn } from '../lib/cn'
import { useEnvStatus } from './env-status'
import { EnvStatusCard } from './EnvStatusCard'

function NavItem({ section, collapsed }: { section: NavSection; collapsed: boolean }): JSX.Element {
  const { t } = useTranslation()
  const label = t(section.labelKey)
  const Icon = section.icon

  return (
    <NavLink
      to={section.path}
      end={section.path === '/'}
      data-testid={`nav-${section.id}`}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          'flex h-8 items-center gap-2.5 rounded-md px-2 text-muted-foreground hover:bg-hover hover:text-foreground',
          isActive && 'bg-active text-foreground',
          collapsed && 'justify-center px-0'
        )
      }
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className={cn('truncate', collapsed && 'sr-only')}>{label}</span>
    </NavLink>
  )
}

/** Barra lateral plegable: nombre de la app, grupos de navegación y pie con estado y Ajustes. */
export function Sidebar(): JSX.Element {
  const { t } = useTranslation()
  const collapsed = usePreferences((state) => state.sidebarCollapsed)
  const toggleSidebar = usePreferences((state) => state.toggleSidebar)
  const envStatus = useEnvStatus()
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'glass m-2 mr-0 flex shrink-0 flex-col overflow-hidden rounded-xl',
        'transition-[width] duration-(--motion-duration) ease-out',
        collapsed ? 'w-14' : 'w-60'
      )}
    >
      <div
        className={cn(
          'app-drag flex h-12 items-center gap-2 px-4',
          collapsed && 'px-0 justify-center'
        )}
      >
        <AppIcon aria-hidden="true" className="size-5 shrink-0 text-accent" />
        <span data-testid="app-name" className={cn('font-semibold', collapsed && 'sr-only')}>
          {APP_NAME}
        </span>
      </div>

      <nav aria-label={t('nav.aria')} className="flex-1 overflow-y-auto px-2">
        {NAV_GROUPS.map((group) => (
          <div key={group} data-testid={`nav-group-${group}`} className="mt-3 first:mt-1">
            <p
              className={cn(
                'px-2 pb-1 text-xs font-medium text-muted-foreground',
                collapsed && 'sr-only'
              )}
            >
              {t(`nav.groups.${group}`)}
            </p>
            <ul className="grid gap-0.5">
              {NAV_SECTIONS.filter((section) => section.group === group).map((section) => (
                <li key={section.id}>
                  <NavItem section={section} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="grid gap-1 p-2">
        <EnvStatusCard status={envStatus} collapsed={collapsed} />
        {NAV_SECTIONS.filter((section) => section.group === null).map((section) => (
          <NavItem key={section.id} section={section} collapsed={collapsed} />
        ))}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          className={cn(
            'flex h-8 items-center rounded-md px-2 text-muted-foreground hover:bg-hover hover:text-foreground',
            collapsed && 'justify-center px-0'
          )}
        >
          <ToggleIcon aria-hidden="true" className="size-4" />
        </button>
      </div>
    </aside>
  )
}
