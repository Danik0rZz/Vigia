import { useId, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MAX_DESCRIPTION_LENGTH,
  type EventDescription,
  type EvidenceView
} from '@shared/problem-evidence'
import { formatNumber } from '@shared/format-number'
import { invoke } from '../lib/ipc'
import { MarkdownText } from './MarkdownText'

/**
 * Sección «Descripción» del detalle de una evidencia (dt.event.description,
 * ficha 0001; de cualquier tipo desde la 0035): siempre con formato (ficha
 * 0002, sin conmutador) y «Copiar», que copia el texto original que llegó de
 * main. Con `title`, es otra propiedad con «description» en la clave (ficha
 * 0035): su clave hace de título y sus data-testid son otros, para no
 * confundirla con la principal.
 */
export function EvidenceDescription({
  description,
  title
}: {
  description: EventDescription
  title?: string
}): JSX.Element {
  const testId = title === undefined ? 'evidence-description' : 'evidence-extra-description'
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle')
  const copyText = (): void => {
    invoke('app:copyText', { text: description.text })
      .then(() => setCopy('done'))
      .catch(() => setCopy('failed'))
  }
  return (
    <section data-testid={testId} aria-labelledby={titleId} className="grid min-w-0 gap-1">
      {/* Sin h*: los títulos del Markdown son los únicos encabezados de la sección. */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          id={titleId}
          role="heading"
          aria-level={4}
          className="text-xs font-medium text-muted-foreground"
        >
          {title ?? t('problems.eventTable.description.title')}
        </div>
        <button
          type="button"
          data-testid={`${testId}-copy`}
          onClick={copyText}
          className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-hover"
        >
          {t('problems.eventTable.description.copy')}
        </button>
        {copy !== 'idle' && (
          <span
            data-testid={`${testId}-copy-status`}
            role="status"
            className="text-xs text-muted-foreground"
          >
            {t(copy === 'done' ? 'errorScreen.copied' : 'errorScreen.copyFailed')}
          </span>
        )}
      </div>
      <MarkdownText text={description.text} />
      {description.truncated && (
        <p data-testid={`${testId}-truncated`} className="text-xs text-muted-foreground">
          {t('problems.eventTable.description.truncated', {
            max: formatNumber(MAX_DESCRIPTION_LENGTH, i18n.language)
          })}
        </p>
      )}
    </section>
  )
}

/**
 * Las descripciones de una evidencia de cualquier tipo (ficha 0035): primero
 * «Descripción» (dt.event.description) y debajo, cada una en su sección, las
 * demás propiedades con «description» en la clave.
 */
export function EvidenceDescriptions({ view }: { view: EvidenceView }): JSX.Element {
  return (
    <>
      {view.description !== null && <EvidenceDescription description={view.description} />}
      {view.extraDescriptions.map((extra, index) => (
        <EvidenceDescription key={`${index}-${extra.key}`} description={extra} title={extra.key} />
      ))}
    </>
  )
}
