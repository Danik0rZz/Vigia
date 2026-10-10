import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityData, EntityTag } from '@shared/modules'
import { formatNumber } from '@shared/format-number'
import type { ModuleAccess } from '../../data/modules'
import {
  TAG_TONE_COUNT,
  fittingTags,
  hasTagContext,
  sortTags,
  tagText,
  tagTone
} from './entity-tags'

// Cápsula (ficha 0049): borde oscuro alrededor y entre las mitades; realce ligero al pasar el
// ratón, sin transición (nada que cambie con «reducir el movimiento»).
const PILL =
  'inline-flex max-w-full min-w-0 overflow-hidden rounded-full border border-tag-border text-xs leading-5 shadow-sm hover:shadow-md hover:brightness-110'
const KEY_PART =
  'capsule-gloss inline-flex min-w-0 items-baseline gap-1 px-2.5 font-semibold text-tag-key-foreground'
const VALUE_PART =
  'capsule-gloss inline-flex min-w-0 border-l border-tag-border bg-tag-value-bg px-2.5 font-medium text-tag-value-foreground'
// Clases literales para que Tailwind las genere; el orden es el de `tagTone`.
const TONE_BACKGROUNDS = [
  'bg-tag-0',
  'bg-tag-1',
  'bg-tag-2',
  'bg-tag-3',
  'bg-tag-4',
  'bg-tag-5',
  'bg-tag-6',
  'bg-tag-7'
] as const satisfies readonly string[] & { length: typeof TAG_TONE_COUNT }
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

/**
 * Una cápsula (ficha 0049): mitad de la clave del tono de su clave (con el contexto como prefijo
 * apagado, si lo hay) y, si hay valor, la mitad clara del valor. Los dos puntos quedan solo para
 * los lectores de pantalla.
 */
function TagPill({ tag, withTestIds }: { tag: EntityTag; withTestIds: boolean }): JSX.Element {
  const id = (name: string): string | undefined => (withTestIds ? name : undefined)
  return (
    <li data-testid={id('entity-tag')} title={tagText(tag)} className={PILL}>
      <span
        data-testid={id('entity-tag-key-part')}
        className={`${KEY_PART} ${TONE_BACKGROUNDS[tagTone(tag.key)] ?? ''}`}
      >
        {hasTagContext(tag) && (
          <span
            data-testid={id('entity-tag-context')}
            className="shrink-0 text-[0.625rem] font-normal opacity-85"
          >
            {`${tag.context} ·`}
          </span>
        )}
        <span data-testid={id('entity-tag-key')} className="min-w-0 truncate">
          {tag.key}
        </span>
      </span>
      {tag.value !== null && (
        <>
          <span className="sr-only">{':'}</span>
          <span data-testid={id('entity-tag-value-part')} className={VALUE_PART}>
            <span data-testid={id('entity-tag-value')} className="min-w-0 truncate">
              {tag.value}
            </span>
          </span>
        </>
      )}
    </li>
  )
}
