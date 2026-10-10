import { useRef, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { BUTTON_DANGER, BUTTON_ICON, BUTTON_SECONDARY } from './styles'

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

/**
 * Modal amplio y vistoso (ficha 0051): centrado, ancho y con el alto de la ventana como máximo;
 * el fondo se oscurece con desenfoque y el panel entra con la animación de `showcase-panel`
 * (`main.css`, solo un fundido con «reducir el movimiento»). Radix atrapa el foco, cierra con
 * Escape y con clic fuera y devuelve el foco a lo que lo tenía al abrir. `testId` va en el
 * elemento con role="dialog" y `${testId}-overlay` en el fondo.
 */
export function ShowcaseDialog({
  open,
  onOpenChange,
  title,
  testId,
  closeLabel,
  onOpenAutoFocus,
  children
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  testId: string
  /** Nombre accesible del botón de cerrar. */
  closeLabel: string
  /** Para llevar el foco a un control concreto al abrir (por defecto, el primero). */
  onOpenAutoFocus?: (event: Event) => void
  children: ReactNode
}): JSX.Element {
  // Sin Dialog.Trigger, Radix no sabe a quién devolver el foco al cerrar: se guarda lo que lo
  // tenía al abrir (el botón que abre el modal) y se le devuelve, si sigue en la página.
  const returnFocus = useRef<HTMLElement | null>(null)
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid={`${testId}-overlay`}
          className={`showcase-overlay ${OVERLAY} backdrop-blur-[3px]`}
        />
        <Dialog.Content
          data-testid={testId}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null
            onOpenAutoFocus?.(event)
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocus.current
            returnFocus.current = null
            if (target?.isConnected === true) {
              event.preventDefault()
              target.focus()
            }
          }}
          className="showcase-panel glass fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[min(1100px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-xl p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="min-w-0 text-lg font-semibold break-words">
              {title}
            </Dialog.Title>
            <Dialog.Close aria-label={closeLabel} title={closeLabel} className={BUTTON_ICON}>
              <X aria-hidden="true" className="size-4" />
            </Dialog.Close>
          </div>
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
