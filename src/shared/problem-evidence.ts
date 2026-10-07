import { z } from 'zod'
import { eventMetricSchema, type EventMetric } from './event-metric'
import { compareCodes, type Comparator, type GridSort } from './grid-sort'
import { formatNumber } from './format-number'

/** Valor que se muestra cuando un dato no está o no es un número. */
export const NOT_AVAILABLE = 'N/A'

/** Entidad de una evidencia tal como cruza el IPC. */
export const evidenceEntitySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  type: z.string().nullable()
})
export type EvidenceEntity = z.output<typeof evidenceEntitySchema>

/** Topes de lo que cruza el IPC desde `data` de un EVENT. */
export const MAX_EVENT_TAGS = 50
export const MAX_EVENT_TAG_LENGTH = 200
export const MAX_EVENT_ZONES = 20

/**
 * Lo que se usa de `data` de una evidencia EVENT (el Event de la API v2): su
 * estado propio, su título e id, los tags de la entidad como texto, las zonas
 * de gestión por nombre y los flags. Lo que no tiene la forma esperada llega
 * como null, [] o false.
 */
export const eventDataSchema = z.object({
  status: z.enum(['OPEN', 'CLOSED']).nullable(),
  /** Tal cual: -1 es "sigue activo"; null si falta o no es un número. */
  endTime: z.number().nullable(),
  title: z.string().nullable(),
  eventId: z.string().nullable(),
  tags: z.array(z.string().max(MAX_EVENT_TAG_LENGTH)).max(MAX_EVENT_TAGS),
  managementZones: z.array(z.string()).max(MAX_EVENT_ZONES),
  flags: z.object({
    maintenance: z.boolean(),
    frequent: z.boolean(),
    /** suppressAlert o suppressProblem. */
    suppressed: z.boolean()
  })
})
export type EventData = z.output<typeof eventDataSchema>

/**
 * Tope de la descripción del evento (`dt.event.description`), ficha 0001. Regla:
 * el doble de la máxima observada en vivo, redondeado hacia arriba al millar,
 * entre 5 000 y 20 000 (el límite de `app:copyText`). Medido el 2026-10-06: la
 * máxima fue 245 caracteres, así que queda en el mínimo.
 */
export const MAX_DESCRIPTION_LENGTH = 5000

/**
 * Descripción del evento (Markdown del tenant, sin interpretar en main): el
 * texto, recortado a MAX_DESCRIPTION_LENGTH, y si se recortó. El campo es
 * `text` y no `value` por la guarda del IPC.
 */
export const eventDescriptionSchema = z.object({
  text: z.string().max(MAX_DESCRIPTION_LENGTH),
  truncated: z.boolean()
})
export type EventDescription = z.output<typeof eventDescriptionSchema>

/**
 * Evidencia de un problema tal como la manda main: los campos de los 5 tipos
 * de la OpenAPI, todos opcionales salvo el tipo y el nombre. El tipo es texto
 * libre (un tipo nuevo de Dynatrace se muestra tal cual) y la unidad también.
 */
export const evidenceWireSchema = z.object({
  evidenceType: z.string(),
  displayName: z.string(),
  entity: evidenceEntitySchema.nullable(),
  groupingEntity: evidenceEntitySchema.nullable(),
  rootCauseRelevant: z.boolean(),
  startTime: z.number().nullable(),
  /** Tal cual: -1 o null es "sigue activa". */
  endTime: z.number().nullable(),
  eventType: z.string().nullable(),
  /**
   * Unas pocas propiedades del evento (`data.properties`), ya como texto. El
   * campo es `text` y no `value`: la guarda del IPC no deja salir textos con
   * nombres de secreto (value, token…).
   */
  properties: z.array(z.object({ key: z.string(), text: z.string() })).max(8),
  metricId: z.string().nullable(),
  unit: z.string().nullable(),
  valueBefore: z.number().nullable(),
  valueAfter: z.number().nullable(),
  /** Solo en EVENT: el selector de métrica (extraído en main, entero) y su umbral. */
  eventMetric: eventMetricSchema.nullable(),
  /** Solo en EVENT: `dt.event.description` (extraída en main, fuera de `properties`). */
  description: eventDescriptionSchema.nullable(),
  /** Solo en EVENT con `data`. */
  data: eventDataSchema.nullable()
})
export type EvidenceWire = z.output<typeof evidenceWireSchema>

/** Entidad lista para mostrar: la etiqueta es el nombre o, si falta, el id. */
export interface EntityLabel {
  id: string
  label: string
  type: string | null
}

export interface ChangeView {
  direction: 'up' | 'down' | 'same'
  /** after / before; null si before es ~0 (entonces va delta). */
  ratio: number | null
  /** after − before, solo si before es ~0. */
  delta: number | null
}

/** Modelo común de una evidencia para la vista y la exportación. */
export interface EvidenceView {
  /** Clave de la fila: el eventId o, si no hay, `ev-<índice>`. */
  id: string
  eventId: string | null
  /** Estado propio (data.status; si no, por endTime). */
  status: 'OPEN' | 'CLOSED'
  /** data.title o, si no hay, displayName. */
  title: string
  /** En EVENT, el eventType (o EVENT); en el resto, el evidenceType. Código tal cual. */
  typeLabel: string
  tags: string[]
  managementZones: string[]
  flags: EventData['flags']
  type: string
  displayName: string
  entity: EntityLabel | null
  start: number | null
  end: number | 'ACTIVE'
  rootCause: boolean
  before: number | null
  after: number | null
  /** Variación entre antes y después (METRIC y TRANSACTIONAL); null sin los dos valores. */
  change: ChangeView | null
  event: {
    eventType: string | null
    properties: { key: string; text: string }[]
    /** Métrica del evento (dt.event.metric_selector), si la trae. */
    metric: EventMetric | null
    /** Descripción del evento (dt.event.description), si la trae. */
    description: EventDescription | null
  } | null
  metricId: string | null
  unit: string | null
}

const label = (entity: EvidenceEntity | null): EntityLabel | null =>
  entity === null ? null : { id: entity.id, label: entity.name ?? entity.id, type: entity.type }

const finite = (value: number | null): value is number => value !== null && Number.isFinite(value)

/** Por debajo de esto, "antes" cuenta como 0: el cociente no tiene sentido. */
const ZERO = 1e-9

/** Dirección y tamaño del cambio; null si falta algún valor (se muestra N/A). */
export function changeOf(before: number | null, after: number | null): ChangeView | null {
  if (!finite(before) || !finite(after)) return null
  const direction = after > before ? 'up' : after < before ? 'down' : 'same'
  if (Math.abs(before) < ZERO) return { direction, ratio: null, delta: after - before }
  return { direction, ratio: after / before, delta: null }
}

const NO_FLAGS: EventData['flags'] = { maintenance: false, frequent: false, suppressed: false }

const isActiveEnd = (end: number | null): boolean =>
  end === null || end === -1 || !Number.isFinite(end)

/**
 * Estado propio: data.status manda (aunque no cuadre con el fin); sin él, un
 * data.endTime null o -1 es activo; si no, decide el fin de la evidencia.
 */
function statusOf(evidence: EvidenceWire): EvidenceView['status'] {
  const data = evidence.data
  if (data !== null) {
    if (data.status !== null) return data.status
    if (data.endTime === null || data.endTime === -1) return 'OPEN'
  }
  return isActiveEnd(evidence.endTime) ? 'OPEN' : 'CLOSED'
}

/**
 * Normaliza una evidencia de cualquier tipo (también uno desconocido). El
 * índice (su posición al llegar) da la clave de la fila si no hay eventId.
 */
export function toEvidenceView(evidence: EvidenceWire, index = 0): EvidenceView {
  const entity = label(evidence.entity)
  const isChange = evidence.evidenceType === 'METRIC' || evidence.evidenceType === 'TRANSACTIONAL'
  const data = evidence.data
  const eventId = data?.eventId ?? null
  return {
    id: eventId ?? `ev-${index}`,
    eventId,
    status: statusOf(evidence),
    title: data !== null && data.title ? data.title : evidence.displayName,
    typeLabel:
      evidence.evidenceType === 'EVENT' ? (evidence.eventType ?? 'EVENT') : evidence.evidenceType,
    tags: data?.tags ?? [],
    managementZones: data?.managementZones ?? [],
    flags: data?.flags ?? NO_FLAGS,
    type: evidence.evidenceType,
    displayName: evidence.displayName,
    entity,
    start: evidence.startTime,
    end: isActiveEnd(evidence.endTime) ? 'ACTIVE' : (evidence.endTime as number),
    rootCause: evidence.rootCauseRelevant,
    before: evidence.valueBefore,
    after: evidence.valueAfter,
    change: isChange ? changeOf(evidence.valueBefore, evidence.valueAfter) : null,
    event:
      evidence.evidenceType === 'EVENT'
        ? {
            eventType: evidence.eventType,
            properties: evidence.properties,
            metric: evidence.eventMetric,
            description: evidence.description
          }
        : null,
    metricId: evidence.metricId,
    unit: evidence.unit
  }
}

/** Columnas por las que se ordena la tabla de evidencias. */
export type EvidenceSortKey =
  'status' | 'title' | 'type' | 'entity' | 'start' | 'end' | 'duration' | 'rootCause'
export type EvidenceSort = GridSort<EvidenceSortKey>

/** Por defecto: abiertos primero (y, por los desempates, los más recientes arriba). */
export const DEFAULT_EVIDENCE_SORT: EvidenceSort = { key: 'status', direction: 'asc' }

const compareNumbers = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0)

/** null al final en los dos sentidos; el resto, en el sentido pedido. */
function nullsLast<T>(a: T | null, b: T | null, sign: number, compare: Comparator<T>): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return sign * compare(a, b)
}

/** Duración en ms: hasta el fin o, si sigue activa, hasta `now`; null sin inicio. */
export function evidenceDuration(view: EvidenceView, now: number): number | null {
  if (view.start === null) return null
  return (view.end === 'ACTIVE' ? now : view.end) - view.start
}

/** Una duración para leerla: segundos por debajo del minuto, minutos por debajo de la hora. */
export type DurationParts =
  | { unit: 's'; seconds: number }
  | { unit: 'min'; minutes: number }
  | { unit: 'h'; hours: number; minutes: number }

export function durationParts(ms: number): DurationParts {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return { unit: 's', seconds }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return { unit: 'min', minutes }
  return { unit: 'h', hours: Math.floor(minutes / 60), minutes: minutes % 60 }
}

/**
 * Copia ordenada. Desempates fijos (no cambian con el sentido): inicio
 * descendente (sin inicio al final), eventId (sin él al final) e id, así el
 * orden no depende de cómo llegaron los datos al refrescar.
 */
export function sortEvidence(
  views: readonly EvidenceView[],
  sort: EvidenceSort,
  lang: string,
  now: number
): EvidenceView[] {
  const text = new Intl.Collator(lang, { sensitivity: 'base', numeric: true }).compare
  const sign = sort.direction === 'asc' ? 1 : -1
  const value: Record<EvidenceSortKey, (view: EvidenceView) => number | string | null> = {
    status: (view) => (view.status === 'OPEN' ? 0 : 1),
    title: (view) => view.title,
    type: (view) => view.typeLabel,
    entity: (view) => view.entity?.label ?? null,
    start: (view) => view.start,
    end: (view) => (view.end === 'ACTIVE' ? Number.POSITIVE_INFINITY : view.end),
    duration: (view) => evidenceDuration(view, now),
    rootCause: (view) => (view.rootCause ? 1 : 0)
  }
  const pick = value[sort.key]
  const compareValues = (a: number | string, b: number | string): number =>
    typeof a === 'string' && typeof b === 'string'
      ? text(a, b)
      : compareNumbers(Number(a), Number(b))
  return [...views].sort(
    (a, b) =>
      nullsLast(pick(a), pick(b), sign, compareValues) ||
      nullsLast(a.start, b.start, -1, compareNumbers) ||
      nullsLast(a.eventId, b.eventId, 1, compareCodes) ||
      compareCodes(a.id, b.id)
  )
}

/** Filtros de la tabla de evidencias. */
export interface EvidenceFilters {
  text: string
  /** typeLabel; vacío = todos. */
  types: string[]
  /** Id de la entidad. */
  entity: string | null
  /** Tag exacto. */
  tag: string | null
  rootCauseOnly: boolean
  status: 'ALL' | 'OPEN' | 'CLOSED'
}

export const EMPTY_EVIDENCE_FILTERS: EvidenceFilters = {
  text: '',
  types: [],
  entity: null,
  tag: null,
  rootCauseOnly: false,
  status: 'ALL'
}

/** Sin tildes ni mayúsculas, para buscar. */
const fold = (value: string): string =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es')

type FilterKey = 'types' | 'status'

function matches(view: EvidenceView, filters: EvidenceFilters, skip?: FilterKey): boolean {
  if (skip !== 'status' && filters.status !== 'ALL' && view.status !== filters.status) return false
  if (skip !== 'types' && filters.types.length > 0 && !filters.types.includes(view.typeLabel)) {
    return false
  }
  if (filters.entity !== null && view.entity?.id !== filters.entity) return false
  if (filters.tag !== null && !view.tags.includes(filters.tag)) return false
  if (filters.rootCauseOnly && !view.rootCause) return false
  const needle = fold(filters.text.trim())
  if (needle === '') return true
  return [
    view.title,
    view.displayName,
    view.typeLabel,
    view.entity?.label ?? '',
    ...view.tags
  ].some((field) => fold(field).includes(needle))
}

/** Las evidencias que pasan todos los filtros, en el mismo orden. */
export function filterEvidence(
  views: readonly EvidenceView[],
  filters: EvidenceFilters
): EvidenceView[] {
  return views.filter((view) => matches(view, filters))
}

/**
 * Los filtros sin los que ocultan esta evidencia (los demás se quedan): lo que
 * hace falta para saltar a ella desde el resumen de la causa raíz.
 */
export function filtersShowing(filters: EvidenceFilters, view: EvidenceView): EvidenceFilters {
  const next = { ...filters }
  if (next.status !== 'ALL' && view.status !== next.status) next.status = 'ALL'
  if (next.types.length > 0 && !next.types.includes(view.typeLabel)) next.types = []
  if (next.entity !== null && view.entity?.id !== next.entity) next.entity = null
  if (next.tag !== null && !view.tags.includes(next.tag)) next.tag = null
  if (next.rootCauseOnly && !view.rootCause) next.rootCauseOnly = false
  if (!matches(view, { ...EMPTY_EVIDENCE_FILTERS, text: next.text })) next.text = ''
  return next
}

/** Contadores Abiertos/Cerrados/Todos: sobre lo que dejan los demás filtros (no el de estado). */
export function countByStatus(
  views: readonly EvidenceView[],
  filters: EvidenceFilters
): { open: number; closed: number; all: number } {
  const shown = views.filter((view) => matches(view, filters, 'status'))
  const open = shown.filter((view) => view.status === 'OPEN').length
  return { open, closed: shown.length - open, all: shown.length }
}

/** Cuántas hay de cada typeLabel: sobre lo que dejan los demás filtros (no el de tipos). */
export function typeCounts(
  views: readonly EvidenceView[],
  filters: EvidenceFilters
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const view of views) {
    if (matches(view, filters, 'types')) counts[view.typeLabel] = (counts[view.typeLabel] ?? 0) + 1
  }
  return counts
}

/** Entidades para el filtro: únicas por id y por su etiqueta en el idioma. */
export function entityOptions(
  views: readonly EvidenceView[],
  lang = 'es'
): { id: string; label: string }[] {
  const byId = new Map<string, string>()
  for (const view of views) {
    if (view.entity !== null && !byId.has(view.entity.id))
      byId.set(view.entity.id, view.entity.label)
  }
  const text = new Intl.Collator(lang, { sensitivity: 'base', numeric: true }).compare
  return [...byId]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => text(a.label, b.label) || compareCodes(a.id, b.id))
}

/** Tags para el filtro: únicos y ordenados en el idioma. */
export function tagOptions(views: readonly EvidenceView[], lang = 'es'): string[] {
  const text = new Intl.Collator(lang, { sensitivity: 'base', numeric: true }).compare
  return [...new Set(views.flatMap((view) => view.tags))].sort(
    (a, b) => text(a, b) || compareCodes(a, b)
  )
}

const TIME_TO_MS: Record<string, number> = {
  NanoSecond: 1e-6,
  MicroSecond: 1e-3,
  MilliSecond: 1,
  Second: 1000
}
const BYTE_STEPS = ['B', 'KB', 'MB', 'GB'] as const

/**
 * Valor con su unidad, en el idioma de la interfaz. Los tiempos pasan a ms o
 * s según su tamaño y los bytes a KB, MB o GB (de 1024 en 1024). Una unidad
 * que no se conoce se muestra con su nombre original. Sin valor: N/A.
 */
export function formatUnit(value: number | null, unit: string | null, lang: string): string {
  if (!finite(value)) return NOT_AVAILABLE
  // Un valor que no es 0 nunca se pinta como 0: "< 0,01" con los decimales que toquen.
  const number = (n: number, digits = 2): string => {
    const format = (x: number): string => formatNumber(x, lang, { maximumFractionDigits: digits })
    const smallest = 10 ** -digits
    if (n !== 0 && Math.abs(n) < smallest / 2) {
      return `${n < 0 ? '> -' : '< '}${format(smallest)}`
    }
    return format(n)
  }
  // La escala se elige con el valor ya redondeado: 999,999 ms es "1 s", no "1.000 ms".
  const rounded = (n: number, digits = 2): number => Math.round(n * 10 ** digits) / 10 ** digits
  const toMs = unit === null ? undefined : TIME_TO_MS[unit]
  if (toMs !== undefined) {
    const ms = value * toMs
    return Math.abs(rounded(ms)) >= 1000 ? `${number(ms / 1000)} s` : `${number(ms)} ms`
  }
  switch (unit) {
    case 'Percent':
      return `${number(value)} %`
    case 'Count':
      return number(value, 0)
    case 'PerMinute':
      return `${number(value)} /min`
    case 'PerSecond':
      return `${number(value)} /s`
    case 'Ratio':
      return number(value, 3)
    case 'Byte': {
      let scaled = value
      let step = 0
      while (Math.abs(rounded(scaled)) >= 1024 && step < BYTE_STEPS.length - 1) {
        scaled /= 1024
        step += 1
      }
      return `${number(scaled)} ${BYTE_STEPS[step]}`
    }
    case null:
      return number(value)
    default:
      return `${number(value)} ${unit}`
  }
}
