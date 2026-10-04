import { z } from 'zod'

/** Valor que se muestra cuando un dato no está o no es un número. */
export const NOT_AVAILABLE = 'N/A'

/** Entidad de una evidencia tal como cruza el IPC. */
export const evidenceEntitySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  type: z.string().nullable()
})
export type EvidenceEntity = z.output<typeof evidenceEntitySchema>

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
  valueAfter: z.number().nullable()
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
  type: string
  displayName: string
  entity: EntityLabel | null
  /** Por dónde se agrupa: groupingEntity o, si no hay, la entidad. */
  group: EntityLabel | null
  start: number | null
  end: number | 'ACTIVE'
  rootCause: boolean
  before: number | null
  after: number | null
  /** Variación entre antes y después (METRIC y TRANSACTIONAL); null sin los dos valores. */
  change: ChangeView | null
  event: { eventType: string | null; properties: { key: string; text: string }[] } | null
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

/** Normaliza una evidencia de cualquier tipo (también uno desconocido). */
export function toEvidenceView(evidence: EvidenceWire): EvidenceView {
  const entity = label(evidence.entity)
  const isChange = evidence.evidenceType === 'METRIC' || evidence.evidenceType === 'TRANSACTIONAL'
  return {
    type: evidence.evidenceType,
    displayName: evidence.displayName,
    entity,
    group: label(evidence.groupingEntity) ?? entity,
    start: evidence.startTime,
    end:
      evidence.endTime === null || evidence.endTime === -1 || !Number.isFinite(evidence.endTime)
        ? 'ACTIVE'
        : evidence.endTime,
    rootCause: evidence.rootCauseRelevant,
    before: evidence.valueBefore,
    after: evidence.valueAfter,
    change: isChange ? changeOf(evidence.valueBefore, evidence.valueAfter) : null,
    event:
      evidence.evidenceType === 'EVENT'
        ? { eventType: evidence.eventType, properties: evidence.properties }
        : null,
    metricId: evidence.metricId,
    unit: evidence.unit
  }
}

const byStart = (a: EvidenceView, b: EvidenceView): number =>
  (a.start ?? Number.MAX_SAFE_INTEGER) - (b.start ?? Number.MAX_SAFE_INTEGER)

/**
 * Causa raíz aparte (sin repetirla debajo) y el resto por entidad: cada grupo
 * en orden cronológico y los grupos por su primera evidencia. Las evidencias
 * sin entidad van juntas en un grupo con entity null.
 */
export function groupEvidence(views: readonly EvidenceView[]): {
  rootCause: EvidenceView[]
  byEntity: { entity: EntityLabel | null; items: EvidenceView[] }[]
} {
  const rootCause = views.filter((view) => view.rootCause).sort(byStart)
  const groups = new Map<string, { entity: EntityLabel | null; items: EvidenceView[] }>()
  for (const view of views) {
    if (view.rootCause) continue
    const key = view.group?.id ?? ''
    const group = groups.get(key) ?? { entity: view.group, items: [] }
    group.items.push(view)
    groups.set(key, group)
  }
  const byEntity = [...groups.values()].map((group) => ({
    entity: group.entity,
    items: group.items.sort(byStart)
  }))
  byEntity.sort((a, b) => byStart(a.items[0] as EvidenceView, b.items[0] as EvidenceView))
  return { rootCause, byEntity }
}

/** Cuántas evidencias hay de cada tipo (sobre todas las recibidas), para los filtros. */
export function countByType(views: readonly EvidenceView[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const view of views) counts[view.type] = (counts[view.type] ?? 0) + 1
  return counts
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
    const format = (x: number): string =>
      new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(x)
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
