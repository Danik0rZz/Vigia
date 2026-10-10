import { useRef, useState, type JSX, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'
import { ShowcaseDialog } from '../../components/dialogs'
import { INPUT } from '../../components/styles'
import { useProcessGroupInstances } from '../../data/modules'
import { MarkerError } from './EntityMarkers'
import { filterInstances, fullListNotice } from './process-group-instances'
import { InstancesTable } from './ProcessGroupInstancesTable'

/*
 * Modal «Ver todas» de la tabla «Instancias» del process group (ficha 0051): la lista completa
 * (`entities:processGroupInstances`, 0050) con las columnas y enlaces de la tabla de la página,
 * orden por columna y buscador por nombre o host. Los datos se piden la primera vez que se abre
 * (lo pide el usuario, ADR-0004) y la consulta sigue activa mientras la página está montada: volver
 * a abrir no pide nada, y «Actualizar» de la página la refresca con lo demás.
 */

const SKELETON_ROWS = 6

export function ProcessGroupInstancesDialog({
  open,
  onOpenChange,
  requested,
  envId,
  groupId,
  groupName
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Ya se abrió alguna vez: la consulta se pide y queda activa. */
  requested: boolean
  envId: string
  groupId: string
  groupName: string
}): JSX.Element {
  const { t } = useTranslation()
  const list = useProcessGroupInstances(envId, groupId, requested)
  const searchRef = useRef<HTMLInputElement | null>(null)

  return (
    <ShowcaseDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('entities.processGroup.instances.dialog.title', { name: groupName })}
      closeLabel={t('entities.processGroup.instances.dialog.close')}
      testId="process-group-instances-dialog"
      onOpenAutoFocus={(event) => {
        // El foco, en el buscador si ya está (con la lista en caché); si no, el de Radix.
        if (searchRef.current !== null) {
          event.preventDefault()
          searchRef.current.focus()
        }
      }}
    >
      <DialogBody list={list} searchRef={searchRef} />
    </ShowcaseDialog>
  )
}

function DialogBody({
  list,
  searchRef
}: {
  list: ReturnType<typeof useProcessGroupInstances>
  searchRef: RefObject<HTMLInputElement | null>
}): JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const text = (key: string, options?: Record<string, unknown>): string =>
    t(`entities.processGroup.instances.dialog.${key}`, options)

  if (list.isError) {
    return (
      <MarkerError error={list.error} busy={list.isFetching} onRetry={() => void list.refetch()} />
    )
  }
  const data = list.data
  if (data === undefined) {
    return (
      <div
        data-testid="process-group-instances-dialog-skeleton"
        role="status"
        aria-label={text('loading')}
        className="grid gap-2"
      >
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <span key={index} className="h-9 rounded-md bg-hover motion-safe:animate-pulse" />
        ))}
      </div>
    )
  }

  const notice = fullListNotice(data)
  const shown = filterInstances(data.items, query)
  let table: ReactNode
  if (shown.length === 0 && data.items.length > 0) {
    table = <p className="text-sm text-muted-foreground">{text('noMatches')}</p>
  } else {
    table = (
      <InstancesTable
        instances={shown}
        gridTestId="process-group-instances-dialog-grid"
        scrollTestId="process-group-instances-dialog-scroll"
      />
    )
  }
  return (
    <>
      {notice !== null && (
        <p
          data-testid="process-group-instances-dialog-truncated"
          role="status"
          className="flex items-start gap-2 rounded-lg border-l-4 border-status-warning bg-hover px-3 py-2 text-sm"
        >
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-status-warning"
          />
          <span>
            {notice.kind === 'of'
              ? text('truncatedOf', { shown: notice.shown, total: notice.total })
              : text('truncated', { shown: notice.shown })}
          </span>
        </p>
      )}
      <input
        ref={searchRef}
        type="search"
        data-testid="process-group-instances-dialog-search"
        aria-label={text('search')}
        placeholder={text('search')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className={`${INPUT} max-w-sm`}
      />
      {table}
    </>
  )
}
