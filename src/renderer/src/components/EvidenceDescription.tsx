import { useId, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_DESCRIPTION_LENGTH, type EventDescription } from '@shared/problem-evidence'
import { invoke } from '../lib/ipc'
import { MarkdownText } from './MarkdownText'

/**
 * Sección «Descripción» del detalle de un EVENT (dt.event.description, ficha
 * 0001): siempre con formato (ficha 0002, sin conmutador) y «Copiar», que copia
 * el texto original que llegó de main.
 */
export function EvidenceDescription({
  description
}: {
  description: EventDescription
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle')
  const copyText = (): void => {
    invoke('app:copyText', { text: description.text })
      .then(() => setCopy('done'))
      .catch(() => setCopy('failed'))
  }
  return (
    <section
      data-testid="evidence-description"
      aria-labelledby={titleId}
      className="grid min-w-0 gap-1"
    >
      {/* Sin h*: los títulos del Markdown son los únicos encabezados de la sección. */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          id={titleId}
          role="heading"
          aria-level={4}
          className="text-xs font-medium text-muted-foreground"
        >
          {t('problems.eventTable.description.title')}
        </div>
        <button
          type="button"
          data-testid="evidence-description-copy"
          onClick={copyText}
          className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-hover"
        >
          {t('problems.eventTable.description.copy')}
        </button>
        {copy !== 'idle' && (
          <span
            data-testid="evidence-description-copy-status"
            role="status"
            className="text-xs text-muted-foreground"
          >
            {t(copy === 'done' ? 'errorScreen.copied' : 'errorScreen.copyFailed')}
          </span>
        )}
      </div>
      <MarkdownText text={description.text} />
      {description.truncated && (
        <p data-testid="evidence-description-truncated" className="text-xs text-muted-foreground">
          {t('problems.eventTable.description.truncated', {
            max: new Intl.NumberFormat(i18n.language).format(MAX_DESCRIPTION_LENGTH)
          })}
        </p>
      )}
    </section>
  )
}
