import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useQuery } from '@tanstack/react-query'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { APP_NAME } from '@shared/app'
import { AppIcon, NAV_GROUPS, NAV_SECTIONS, type NavSection } from '../app/navigation'
import { usePreferences } from '../app/preferences'
import { unavailableReason, useModuleAccess, type ModuleAccess } from '../data/modules'
import { cn } from '../lib/cn'
import { invoke } from '../lib/ipc'
import { useEnvStatus } from './env-status'
import { EnvStatusCard } from './EnvStatusCard'

/** Inicio, Problemas y Métricas dependen del entorno, del token y de los permisos. */
type ModuleAccessById = Partial<Record<string, ModuleAccess>>

function NavItem({
  section,
  collapsed,
  access
}: {
  section: NavSection
  collapsed: boolean
  access: ModuleAccess | undefined
}): JSX.Element {
  const { t } = useTranslation()
  const label = t(section.labelKey)
  const Icon = section.icon
  const reason = access !== undefined && !access.available ? unavailableReason(access) : null
  const help = reason !== null ? t(reason.key, reason.params) : t(`navHelp.${section.id}`)
  // Plegado, el nombre solo se ve en el tooltip: va delante.
  const tooltip = collapsed ? `${label}: ${help}` : help

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <NavLink
          to={section.path}
          end={section.path === '/'}
          data-testid={`nav-${section.id}`}
          // Sigue navegando: la página explica por qué no está disponible.
          data-unavailable={reason !== null ? 'true' : undefined}
          // Cadena fija, no función: el Slot de Radix (asChild) fusiona className como
          // cadena. El estado activo lo pinta CSS con el aria-current que pone NavLink.
          className={cn(
            'flex h-8 items-center gap-2.5 rounded-md px-2 text-muted-foreground hover:bg-hover hover:text-foreground',
            'aria-[current=page]:bg-active aria-[current=page]:text-foreground',
            reason !== null && 'opacity-60',
            collapsed && 'justify-center px-0'
          )}
        >
          <Icon aria-hidden="true" className="size-4 shrink-0" />
          <span className={cn('truncate', collapsed && 'sr-only')}>{label}</span>
          {reason !== null && <span className="sr-only">{` ${t('nav.unavailable')}`}</span>}
        </NavLink>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={8}
          className="glass z-50 max-w-64 rounded-md px-3 py-2 text-xs text-foreground"
        >
          {tooltip}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/** Barra lateral plegable: nombre de la app, grupos de navegación y pie con estado y Ajustes. */
export function Sidebar(): JSX.Element {
  const { t } = useTranslation()
  const collapsed = usePreferences((state) => state.sidebarCollapsed)
  const toggleSidebar = usePreferences((state) => state.toggleSidebar)
  const envStatus = useEnvStatus()
  const access: ModuleAccessById = {
    home: useModuleAccess('home'),
    problems: useModuleAccess('problems'),
    metrics: useModuleAccess('metrics')
  }
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose
  // Lo decide main (app.isPackaged): el renderer no lo deduce por su cuenta.
  const appInfo = useQuery({ queryKey: ['appInfo'], queryFn: () => invoke('app:getInfo') })

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
        {!collapsed && appInfo.data?.packaged === false && (
          // Sin empaquetar (npm run dev, e2e): datos en vigia-dev, no los del zip.
          <span
            data-testid="dev-badge"
            className="rounded border border-border px-1 text-[10px] font-medium text-muted-foreground"
          >
            {t('app.dev')}
          </span>
        )}
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
                  <NavItem section={section} collapsed={collapsed} access={access[section.id]} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="grid gap-1 p-2">
        <EnvStatusCard status={envStatus} collapsed={collapsed} />
        {NAV_SECTIONS.filter((section) => section.group === null).map((section) => (
          <NavItem
            key={section.id}
            section={section}
            collapsed={collapsed}
            access={access[section.id]}
          />
        ))}
        <button
          type="button"
          data-testid="sidebar-toggle"
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
