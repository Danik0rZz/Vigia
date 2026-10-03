import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import * as Dialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import { ChartLine, Server } from 'lucide-react'
import { NAV_SECTIONS } from '../app/navigation'
import { useSavedQueries } from '../data/modules'
import { useActiveEnvironment, useEnvironmentOptions, useTenantMutation } from '../data/tenants'
import { EnvTypeBadge } from './EnvTypeBadge'

const GROUP =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground'
const ITEM =
  'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-3 text-muted-foreground data-[selected=true]:bg-active data-[selected=true]:text-foreground'

/**
 * Paleta de comandos (Ctrl+K): navega a las mismas secciones que el menú y
 * activa un entorno ("Cliente › Entorno").
 */
export function CommandPalette({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const environmentGroups = useEnvironmentOptions().filter((group) => group.options.length > 0)
  const setActive = useTenantMutation('environments:setActive')
  const active = useActiveEnvironment()
  const savedQueries = useSavedQueries(active?.environment.id ?? null).data ?? []

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-overlay" />
        <Dialog.Content
          data-testid="command-palette"
          aria-describedby={undefined}
          className="glass fixed top-24 left-1/2 w-[min(560px,90vw)] -translate-x-1/2 overflow-hidden rounded-xl"
        >
          <Dialog.Title className="sr-only">{t('palette.title')}</Dialog.Title>
          <Command label={t('palette.title')}>
            <Command.Input
              placeholder={t('palette.placeholder')}
              className="h-12 w-full border-b border-border bg-transparent px-4 outline-none placeholder:text-muted-foreground"
            />
            <Command.List className="max-h-80 overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-muted-foreground">
                {t('palette.empty')}
              </Command.Empty>
              <Command.Group heading={t('palette.sections')} className={GROUP}>
                {NAV_SECTIONS.map((section) => {
                  const label = t(section.labelKey)
                  const Icon = section.icon
                  return (
                    <Command.Item
                      key={section.id}
                      value={label}
                      onSelect={() => {
                        void navigate(section.path)
                        onOpenChange(false)
                      }}
                      className={ITEM}
                    >
                      <Icon aria-hidden="true" className="size-4" />
                      {label}
                    </Command.Item>
                  )
                })}
              </Command.Group>
              {savedQueries.length > 0 && (
                <Command.Group heading={t('palette.savedQueries')} className={GROUP}>
                  {savedQueries.map((savedQuery) => (
                    <Command.Item
                      key={savedQuery.id}
                      value={savedQuery.name}
                      keywords={[savedQuery.metricSelector]}
                      onSelect={() => {
                        void navigate(`/metrics?saved=${savedQuery.id}`)
                        onOpenChange(false)
                      }}
                      className={ITEM}
                    >
                      <ChartLine aria-hidden="true" className="size-4" />
                      {savedQuery.name}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {environmentGroups.map((group) => (
                <Command.Group key={group.client.id} heading={group.client.name} className={GROUP}>
                  {group.options.map(({ environment, full }) => (
                    <Command.Item
                      key={environment.id}
                      value={full}
                      onSelect={() => {
                        setActive.mutate([{ environmentId: environment.id }])
                        onOpenChange(false)
                      }}
                      className={ITEM}
                    >
                      <Server aria-hidden="true" className="size-4" />
                      {full}
                      <EnvTypeBadge type={environment.type} />
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
