import { useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import type { SavedQuery } from '@shared/modules'
import { ConfirmDialog } from '../../components/dialogs'
import { BUTTON_ICON } from '../../components/styles'

/** Consultas guardadas del entorno: cargar una o borrarla (con confirmación). */
export function SavedQueriesPanel({
  queries,
  onLoad,
  onDelete
}: {
  queries: readonly SavedQuery[] | undefined
  onLoad: (query: SavedQuery) => void
  onDelete: (id: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState<SavedQuery | null>(null)

  return (
    <section
      className="glass grid content-start gap-2 rounded-xl p-4"
      aria-label={t('metrics.saved')}
    >
      <h2 className="text-sm font-semibold">{t('metrics.saved')}</h2>
      {(queries?.length ?? 0) === 0 && (
        <p className="text-xs text-muted-foreground">{t('metrics.noSaved')}</p>
      )}
      <ul className="grid gap-0.5">
        {queries?.map((savedQuery) => (
          <li
            key={savedQuery.id}
            data-testid="saved-query"
            className="flex items-center gap-1 rounded-md hover:bg-hover"
          >
            <button
              type="button"
              onClick={() => onLoad(savedQuery)}
              className="flex-1 truncate px-2 py-1 text-left text-sm"
              title={savedQuery.metricSelector}
            >
              {savedQuery.name}
            </button>
            <button
              type="button"
              data-testid="saved-query-delete"
              aria-label={t('metrics.delete')}
              title={t('metrics.delete')}
              onClick={() => setDeleting(savedQuery)}
              className={BUTTON_ICON}
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        title={deleting === null ? '' : t('metrics.deleteConfirm', { name: deleting.name })}
        description={t('metrics.deleteBody')}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting !== null) onDelete(deleting.id)
          setDeleting(null)
        }}
      />
    </section>
  )
}
