import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Dialog from '@radix-ui/react-dialog'
import { BUTTON_DANGER, BUTTON_SECONDARY } from './styles'

const OVERLAY = 'fixed inset-0 z-40 bg-overlay'
const CONTENT =
  'glass fixed top-1/2 left-1/2 z-50 max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl p-5'

/** Diálogo modal con título; `testId` va en el elemento con role="dialog". */
export function FormDialog({
  open,
  onOpenChange,
  title,
  testId,
  wide = false,
  children
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  testId: string
  wide?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content
          data-testid={testId}
          aria-describedby={undefined}
          className={`${CONTENT} ${wide ? 'w-[min(720px,92vw)]' : 'w-[min(440px,92vw)]'}`}
        >
          <Dialog.Title className="mb-4 text-lg font-semibold">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Confirmación de una acción destructiva (borrar). */
export function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel
}: {
  open: boolean
  title: string
  description: string
  onConfirm: () => void
  onCancel: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={OVERLAY} />
        <AlertDialog.Content
          data-testid="confirm-dialog"
          className={`${CONTENT} w-[min(420px,92vw)]`}
        >
          <AlertDialog.Title className="text-lg font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-muted-foreground">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel data-testid="confirm-cancel" className={BUTTON_SECONDARY}>
              {t('confirm.cancel')}
            </AlertDialog.Cancel>
            <AlertDialog.Action
              data-testid="confirm-accept"
              onClick={onConfirm}
              className={BUTTON_DANGER}
            >
              {t('confirm.accept')}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
