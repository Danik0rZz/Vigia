import { CONTEXTLESS_TAG, type EntityTag } from '@shared/modules'

/**
 * Lógica de la fila de píldoras de etiquetas de las páginas de entidad (ficha 0037), sin React:
 * el orden, el texto completo de cada etiqueta y cuántas caben en dos líneas antes de «+N».
 */

/** Líneas de píldoras que se ven antes de «+N». */
export const TAG_LINES = 2

/** Por clave en orden alfabético (del idioma de la interfaz); a igual clave, por valor y contexto. */
export function sortTags(tags: readonly EntityTag[], lang: string): EntityTag[] {
  const collator = new Intl.Collator(lang, { sensitivity: 'base', numeric: true })
  return [...tags].sort(
    (a, b) =>
      collator.compare(a.key, b.key) ||
      collator.compare(a.value ?? '', b.value ?? '') ||
      collator.compare(a.context, b.context)
  )
}

/** ¿Lleva prefijo de contexto? Las propias (`CONTEXTLESS`) no. */
export const hasTagContext = (tag: EntityTag): boolean => tag.context !== CONTEXTLESS_TAG

/**
 * El texto completo, como `stringRepresentation` de Dynatrace: `[CONTEXTO]clave:valor`, sin
 * prefijo en las propias y sin «:valor» en las de solo clave (tooltip de la píldora).
 */
export function tagText(tag: EntityTag): string {
  const prefix = hasTagContext(tag) ? `[${tag.context}]` : ''
  return tag.value === null ? `${prefix}${tag.key}` : `${prefix}${tag.key}:${tag.value}`
}

/** Tonos de la paleta de la mitad de la clave (`--tag-0` a `--tag-7` en `main.css`, ficha 0049). */
export const TAG_TONE_COUNT = 8

/**
 * Tono de la clave (ficha 0049): un hash FNV-1a de 32 bits de la clave en minúsculas, módulo la
 * paleta. Pura y estable: la misma clave (sin distinguir mayúsculas) da siempre el mismo color,
 * así que las etiquetas de la misma familia se reconocen de un vistazo.
 */
export function tagTone(key: string): number {
  const text = key.toLowerCase()
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % TAG_TONE_COUNT
}

/** Margen al decidir si algo cabe en la línea: los anchos medidos llevan decimales. */
const FIT_SLACK = 1

/** Líneas que ocupan unas cajas de estos anchos en un `flex-wrap` de ese ancho y hueco. */
export function lineCount(widths: readonly number[], width: number, gap: number): number {
  let lines = 0
  let used = 0
  for (const raw of widths) {
    // Una píldora más ancha que la fila se recorta al ancho de la fila (`max-w-full`).
    const box = Math.min(raw, width)
    if (lines === 0) {
      lines = 1
      used = box
    } else if (used + gap + box > width - FIT_SLACK) {
      lines += 1
      used = box
    } else {
      used += gap + box
    }
  }
  return lines
}

/**
 * Cuántas píldoras se ven plegadas: todas si caben en `TAG_LINES` líneas; si no, las primeras
 * que caben junto al botón «+N» (de ancho `moreWidth`). Como una píldora no pasa del ancho de
 * la fila, con una fila muy estrecha se ve al menos la primera (recortada) y «+N».
 */
export function fittingTags(
  widths: readonly number[],
  moreWidth: number,
  width: number,
  gap: number
): number {
  if (width <= 0) return widths.length
  if (lineCount(widths, width, gap) <= TAG_LINES) return widths.length
  for (let count = widths.length - 1; count > 0; count -= 1) {
    if (lineCount([...widths.slice(0, count), moreWidth], width, gap) <= TAG_LINES) return count
  }
  return 0
}
