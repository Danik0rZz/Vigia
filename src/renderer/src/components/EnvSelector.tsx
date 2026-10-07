import { useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { ChevronsUpDown } from 'lucide-react'
import {
  environmentPath,
  useActiveEnvironment,
  useEnvironmentOptions,
  useTenantMutation
} from '../data/tenants'
import { EnvTypeBadge } from './EnvTypeBadge'

const GROUP =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground'

/** Selector "Cliente › Entorno" de la barra superior, con búsqueda y agrupado por cliente. */
export function EnvSelector(): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const groups = useEnvironmentOptions()
  const active = useActiveEnvironment()
  const setActive = useTenantMutation('environments:setActive')

  // min-w-16: con la ventana estrecha encoge (el nombre se recorta) para dejar sitio a la
  // ruta de la barra superior, sin perder el distintivo ni la flecha (ficha 0005).
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        data-testid="env-selector"
        aria-label={t('envSelector.label')}
        className="app-no-drag flex h-7 max-w-72 min-w-16 items-center gap-1.5 rounded-md border border-border px-2 text-xs hover:bg-hover"
      >
        {active === null ? (
          <span className="text-muted-foreground">{t('envSelector.none')}</span>
        ) : (
          <>
            <EnvTypeBadge type={active.environment.type} />
            <span className="truncate">{environmentPath(active.client, active.label)}</span>
          </>
        )}
        <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="glass z-50 w-72 overflow-hidden rounded-lg"
        >
          <Command label={t('envSelector.label')}>
            <Command.Input
              autoFocus
              placeholder={t('envSelector.placeholder')}
              className="h-9 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
            />
            <Command.List className="max-h-64 overflow-y-auto p-1">
              <Command.Empty className="px-3 py-4 text-center text-xs text-muted-foreground">
                {t('envSelector.empty')}
              </Command.Empty>
              {groups
                .filter((group) => group.options.length > 0)
                .map((group) => (
                  <Command.Group
                    key={group.client.id}
                    heading={group.client.name}
                    className={GROUP}
                  >
                    {group.options.map(({ environment, full }) => (
                      <Command.Item
                        key={environment.id}
                        value={full}
                        onSelect={() => {
                          setActive.mutate([{ environmentId: environment.id }])
                          setOpen(false)
                        }}
                        className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-muted-foreground data-[selected=true]:bg-active data-[selected=true]:text-foreground"
                      >
                        <EnvTypeBadge type={environment.type} />
                        {full}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
