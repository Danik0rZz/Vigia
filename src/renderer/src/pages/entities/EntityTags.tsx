import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityData, EntityTag } from '@shared/modules'
import { formatNumber } from '@shared/format-number'
import type { ModuleAccess } from '../../data/modules'
import { fittingTags, hasTagContext, sortTags, tagText } from './entity-tags'

const PILL =
  'inline-flex max-w-full min-w-0 items-baseline gap-1 rounded-full border border-border bg-hover px-2.5 py-0.5 text-xs'
const MORE =
  'rounded-full border border-border px-2.5 py-0.5 text-xs font-medium hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring'

/**
 * Fila de píldoras con las etiquetas de la entidad (ficha 0037), entre la cabecera y los
 * marcadores: `clave: valor` (o la clave sola), con el contexto como prefijo si no es
 * `CONTEXTLESS`, por orden alfabético y en dos líneas como mucho; «+N» despliega el resto. Sin
 * etiquetas, sin datos todavía o sin `entities.read`, no sale (el aviso del scope ya lo da la
 * tarjeta «Información»). Todo lo del tenant se pinta como texto.
 */
export function EntityTags({
  access,
  info
}: {
  access: ModuleAccess
  info: UseQueryResult<EntityData>
}): JSX.Element | null {
  const tags = access.available ? info.data?.tags : undefined
  if (tags === undefined || tags.length === 0) return null
  return <TagRow tags={tags} />
}

function TagRow({ tags }: { tags: EntityTag[] }): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const sorted = useMemo(() => sortTags(tags, lang), [tags, lang])
  const [expanded, setExpanded] = useState(false)
  // Cuántas caben plegadas; null hasta medir.
  const [fit, setFit] = useState<number | null>(null)
  const measureRef = useRef<HTMLUListElement>(null)

  // Se mide una copia invisible con todas las píldoras y un «+N» de muestra, y se vuelve a medir
  // cuando cambia el ancho de la fila (ResizeObserver avisa también al empezar a observar).
  useEffect(() => {
    const list = measureRef.current
    if (list === null) return
    const measure = (): void => {
      const items = [...list.children] as HTMLElement[]
      const more = items.pop()
      const style = getComputedStyle(list)
      const gap = Number.parseFloat(style.columnGap) || 0
      setFit(
        fittingTags(
          items.map((item) => item.getBoundingClientRect().width),
          more?.getBoundingClientRect().width ?? 0,
          list.clientWidth,
          gap
        )
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [sorted])

  const shownCount = expanded || fit === null ? sorted.length : fit
  const hidden = sorted.length - shownCount

  return (
    <div data-testid="entity-tags" role="group" aria-label={t('entities.tags.label')}>
      <ul className="flex flex-wrap gap-1.5">
        {sorted.slice(0, shownCount).map((tag, index) => (
          <TagPill key={`${index}-${tagText(tag)}`} tag={tag} withTestIds />
        ))}
        {hidden > 0 && (
          <li className="inline-flex">
            <button
              type="button"
              data-testid="entity-tags-more"
              aria-label={t('entities.tags.more', { count: hidden })}
              onClick={() => setExpanded(true)}
              className={MORE}
            >
              {`+${formatNumber(hidden, lang)}`}
            </button>
          </li>
        )}
      </ul>
      {/* Copia para medir: sin alto, invisible y fuera del árbol accesible. */}
      {!expanded && (
        <div aria-hidden="true" className="invisible h-0 overflow-hidden">
          <ul ref={measureRef} className="flex flex-wrap gap-1.5">
            {sorted.map((tag, index) => (
              <TagPill key={`${index}-${tagText(tag)}`} tag={tag} withTestIds={false} />
            ))}
            <li className="inline-flex">
              <span className={MORE}>{`+${formatNumber(sorted.length, lang)}`}</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}

/** Una píldora: contexto (si lo hay), clave y, si hay valor, «: valor» en otro tono. */
function TagPill({ tag, withTestIds }: { tag: EntityTag; withTestIds: boolean }): JSX.Element {
  const id = (name: string): string | undefined => (withTestIds ? name : undefined)
  return (
    <li data-testid={id('entity-tag')} title={tagText(tag)} className={PILL}>
      {hasTagContext(tag) && (
        <span
          data-testid={id('entity-tag-context')}
          className="shrink-0 text-[0.625rem] text-muted-foreground"
        >
          {`[${tag.context}]`}
        </span>
      )}
      <span data-testid={id('entity-tag-key')} className="min-w-0 truncate text-muted-foreground">
        {tag.key}
      </span>
      {tag.value !== null && (
        <>
          <span className="-ml-1 text-muted-foreground">{':'}</span>
          <span
            data-testid={id('entity-tag-value')}
            className="min-w-0 truncate font-medium text-foreground"
          >
            {tag.value}
          </span>
        </>
      )}
    </li>
  )
}
