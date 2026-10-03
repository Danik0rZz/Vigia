import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import * as Dialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import { NAV_SECTIONS } from '../app/navigation'

/** Paleta de comandos (Ctrl+K): busca entre las mismas secciones que el menú y navega. */
export function CommandPalette({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()

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
                    className="flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-3 text-muted-foreground data-[selected=true]:bg-active data-[selected=true]:text-foreground"
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {label}
                  </Command.Item>
                )
              })}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
