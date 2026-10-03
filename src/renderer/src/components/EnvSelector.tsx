import { useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { ChevronsUpDown } from 'lucide-react'
import {
  environmentLabel,
  useActiveEnvironment,
  useTenantMutation,
  useTenants
} from '../data/tenants'
import { ProductionBadge } from './ProductionBadge'

/** Selector "Cliente › Entorno" de la barra superior, con búsqueda. */
export function EnvSelector(): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { clients, environments } = useTenants()
  const active = useActiveEnvironment()
  const setActive = useTenantMutation('environments:setActive')

  const options = environments.flatMap((environment) => {
    const client = clients.find((candidate) => candidate.id === environment.clientId)
    return client === undefined
      ? []
      : [{ environment, label: environmentLabel(client, environment) }]
  })

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        data-testid="env-selector"
        aria-label={t('envSelector.label')}
        className="app-no-drag flex h-7 max-w-72 items-center gap-1.5 rounded-md border border-border px-2 text-xs hover:bg-hover"
      >
        {active === null ? (
          <span className="text-muted-foreground">{t('envSelector.none')}</span>
        ) : (
          <>
            {active.environment.type === 'production' && <ProductionBadge />}
            <span className="truncate">{environmentLabel(active.client, active.environment)}</span>
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
              {options.map(({ environment, label }) => (
                <Command.Item
                  key={environment.id}
                  value={label}
                  onSelect={() => {
                    setActive.mutate([{ environmentId: environment.id }])
                    setOpen(false)
                  }}
                  className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-muted-foreground data-[selected=true]:bg-active data-[selected=true]:text-foreground"
                >
                  {label}
                  {environment.type === 'production' && <ProductionBadge />}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
