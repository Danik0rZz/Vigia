import { z } from 'zod'
import { parseItems } from '../dynatrace/parse-items'
import {
  problemStatuses,
  type EntityProblem,
  type EntityRef,
  type ImpactLevel,
  type ProblemComment,
  type ProblemDetail,
  type ProblemSummary,
  type SeverityLevel
} from '@shared/modules'
import { eventMetricInfo } from '@shared/event-metric'
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_EVENT_TAGS,
  MAX_EVENT_TAG_LENGTH,
  MAX_EVENT_ZONES,
  type EventData,
  type EventDescription,
  type EvidenceEntity,
  type EvidenceWire
} from '@shared/problem-evidence'

/** Máximo de caracteres de `text()` en el problemSelector (Environment API v2). */
const MAX_TEXT = 30

export interface ProblemFilters {
  status?: 'open' | 'closed' | undefined
  severity?: readonly SeverityLevel[] | undefined
  impact?: readonly ImpactLevel[] | undefined
  text?: string | undefined
}

const quote = (value: string): string => `"${value}"`

/** En los valores del selector, `~` y `"` se escapan con `~` (primero `~`). */
const escapeValue = (value: string): string => value.replaceAll('~', '~~').replaceAll('"', '~"')

/**
 * problemSelector de GET /api/v2/problems: un criterio por filtro, separados por
 * coma (AND); los valores de cada criterio, entre comillas (OR).
 */
export function buildProblemSelector(filters: ProblemFilters): string | undefined {
  const criteria: string[] = []
  if (filters.status !== undefined) criteria.push(`status(${quote(filters.status)})`)
  if (filters.severity !== undefined && filters.severity.length > 0) {
    criteria.push(`severityLevel(${filters.severity.map(quote).join(',')})`)
  }
  if (filters.impact !== undefined && filters.impact.length > 0) {
    criteria.push(`impactLevel(${filters.impact.map(quote).join(',')})`)
  }
  const text = filters.text?.trim().slice(0, MAX_TEXT) ?? ''
  if (text !== '') criteria.push(`text(${quote(escapeValue(text))})`)
  return criteria.length === 0 ? undefined : criteria.join(',')
}

/**
 * Selector de los problemas que afectan a una entidad con un estado (ficha
 * 0007). Solo `affectedEntities`, no causa raíz ni impactadas. El id ya viene
 * validado con `entityIdSchema` (sin comillas ni paréntesis).
 */
export function entityProblemSelector(entityId: string, status: 'open' | 'closed'): string {
  return `affectedEntities(${quote(entityId)}),status(${quote(status)})`
}

/**
 * Selector de todos los problemas que afectan a una entidad, sin filtrar por estado
 * (lista de la franja, ficha 0010). El id ya viene validado con `entityIdSchema`.
 */
export function entityProblemListSelector(entityId: string): string {
  return `affectedEntities(${quote(entityId)})`
}

/**
 * Problem de la API v2 con solo los campos de la franja (ficha 0010): el resto no se
 * valida, para que un cambio en campos que no se usan no descarte el problema.
 * `endTime` es -1 si sigue abierto (OpenAPI); se acepta también null.
 */
export const entityProblemItemSchema = z.looseObject({
  problemId: z.string(),
  displayId: z.string(),
  title: z.string(),
  status: z.enum(problemStatuses),
  severityLevel: z.string(),
  startTime: z.number(),
  endTime: z.number().nullable()
})

export function toEntityProblem(problem: z.output<typeof entityProblemItemSchema>): EntityProblem {
  return {
    problemId: problem.problemId,
    displayId: problem.displayId,
    title: problem.title,
    status: problem.status,
    severityLevel: problem.severityLevel,
    startTime: problem.startTime,
    endTime: problem.endTime === null || problem.endTime === -1 ? null : problem.endTime
  }
}

/** Respuesta de /problems de la que solo se usa `totalCount` (el resto puede variar). */
export const problemCountPageSchema = z.looseObject({ totalCount: z.unknown().optional() })

/** `totalCount` si es un entero no negativo; si no llega (o no lo es), null y no 0. */
export function toProblemCount(page: z.output<typeof problemCountPageSchema>): number | null {
  const total = page.totalCount
  return typeof total === 'number' && Number.isInteger(total) && total >= 0 ? total : null
}

/** EntityStub: `name` no viene si la entidad ya no existe. */
const entityStubSchema = z.object({
  entityId: z.object({ id: z.string(), type: z.string() }),
  name: z.string().optional()
})

/**
 * Problem de la API v2. Los obligatorios son los que marca la spec; severidad e
 * impacto son texto (Dynatrace puede añadir valores); los campos desconocidos
 * no rompen nada.
 */
export const problemSchema = z.looseObject({
  problemId: z.string(),
  displayId: z.string(),
  title: z.string(),
  status: z.enum(problemStatuses),
  severityLevel: z.string(),
  impactLevel: z.string(),
  startTime: z.number(),
  /** -1 si el problema sigue abierto. */
  endTime: z.number(),
  affectedEntities: z.array(entityStubSchema),
  impactedEntities: z.array(entityStubSchema),
  managementZones: z.array(z.object({ id: z.string(), name: z.string() })),
  problemFilters: z.array(z.unknown()),
  rootCauseEntity: entityStubSchema.nullable().optional(),
  /** Clave con puntos, no un objeto anidado. */
  'k8s.namespace.name': z.array(z.string()).optional(),
  /** Llegan aunque la OpenAPI no los declara (exploración del bloque a). */
  'k8s.cluster.name': z.array(z.string()).optional(),
  'k8s.cluster.uid': z.array(z.string()).optional()
})
export type Problem = z.output<typeof problemSchema>

export const problemsPageSchema = z.object({
  problems: z.array(problemSchema),
  totalCount: z.number(),
  nextPageKey: z.string().nullable().optional()
})

function toEntity(stub: z.output<typeof entityStubSchema>): EntityRef {
  return { id: stub.entityId.id, type: stub.entityId.type, name: stub.name ?? null }
}

export function toProblemSummary(problem: Problem): ProblemSummary {
  return {
    problemId: problem.problemId,
    displayId: problem.displayId,
    title: problem.title,
    status: problem.status,
    severityLevel: problem.severityLevel,
    impactLevel: problem.impactLevel,
    startTime: problem.startTime,
    endTime: problem.endTime === -1 ? null : problem.endTime,
    affectedEntities: problem.affectedEntities.map(toEntity),
    impactedEntities: problem.impactedEntities.map(toEntity),
    rootCause: problem.rootCauseEntity ? toEntity(problem.rootCauseEntity) : null,
    managementZones: problem.managementZones.map((zone) => zone.name),
    namespaces: problem['k8s.namespace.name'] ?? [],
    clusters: problem['k8s.cluster.name'] ?? []
  }
}

/** EntityStub tolerante para las evidencias: aquí todo puede faltar. */
const looseEntityStubSchema = z
  .looseObject({
    entityId: z.looseObject({ id: z.string().optional(), type: z.string().optional() }).optional(),
    name: z.string().optional()
  })
  .nullable()
  .optional()

/**
 * Evidencia (los 5 tipos de la OpenAPI y los que vengan): el tipo es texto
 * libre y la unidad también (AUD-08), y solo el tipo y el nombre son
 * obligatorios para poder mostrarla.
 */
const evidenceItemSchema = z.looseObject({
  evidenceType: z.string(),
  displayName: z.string(),
  entity: looseEntityStubSchema,
  groupingEntity: looseEntityStubSchema,
  rootCauseRelevant: z.boolean().optional(),
  startTime: z.number().nullable().optional(),
  endTime: z.number().nullable().optional(),
  eventType: z.string().optional(),
  // Sin esquema: un data de forma rara no tira la evidencia (se lee campo a campo).
  data: z.unknown().optional(),
  metricId: z.string().optional(),
  unit: z.string().optional(),
  valueBeforeChangePoint: z.number().nullable().optional(),
  valueAfterChangePoint: z.number().nullable().optional()
})
/** Comentario: según la OpenAPI, solo createdAtTimestamp es obligatorio. */
const commentItemSchema = z.looseObject({
  authorName: z.string().optional(),
  content: z.string().optional(),
  context: z.string().optional(),
  createdAtTimestamp: z.number()
})

/** Propiedades del evento que se muestran (como texto y recortadas). */
const MAX_EVENT_PROPERTIES = 8
const MAX_PROPERTY_LENGTH = 300

function toEvidenceEntity(stub: z.output<typeof looseEntityStubSchema>): EvidenceEntity | null {
  const id = stub?.entityId?.id
  if (id === undefined) return null
  return { id, name: stub?.name ?? null, type: stub?.entityId?.type ?? null }
}

function propertyText(value: unknown): string {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '')
  return text.slice(0, MAX_PROPERTY_LENGTH)
}

type Raw = Record<string, unknown>

const asObject = (value: unknown): Raw | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : null

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** Las propiedades del evento con clave de texto (las demás se ignoran). */
function rawProperties(data: Raw | null): { key: string; value: unknown }[] {
  const list = data?.['properties']
  if (!Array.isArray(list)) return []
  return list.flatMap((entry) => {
    const property = asObject(entry)
    const key = asString(property?.['key'])
    return property === null || key === null ? [] : [{ key, value: property['value'] }]
  })
}

/** Propiedad observada del evento con su descripción en Markdown (ficha 0001). */
const DESCRIPTION_KEY = 'dt.event.description'

/**
 * La primera `dt.event.description` con texto no vacío (sin contar espacios),
 * sobre las propiedades EN CRUDO y tal cual (sin recortar espacios), recortada
 * a MAX_DESCRIPTION_LENGTH. Sin ella, null. Nunca va al log.
 */
export function eventDescription(
  properties: readonly { key: string; value: unknown }[]
): EventDescription | null {
  for (const property of properties) {
    if (property.key !== DESCRIPTION_KEY) continue
    const text = property.value
    if (typeof text !== 'string' || text.trim() === '') continue
    return text.length > MAX_DESCRIPTION_LENGTH
      ? { text: text.slice(0, MAX_DESCRIPTION_LENGTH), truncated: true }
      : { text, truncated: false }
  }
  return null
}

/** Tag como texto: stringRepresentation o, si falta o está vacía, key:value o key. */
function tagText(entry: unknown): string | null {
  const tag = asObject(entry)
  if (tag === null) return null
  const text = asString(tag['stringRepresentation'])
  if (text !== null && text !== '') return text
  const key = asString(tag['key'])
  if (key === null || key === '') return null
  const value = asString(tag['value'])
  return value === null || value === '' ? key : `${key}:${value}`
}

/** Lo que se usa de data (Event de la API v2), campo a campo y con topes. */
function toEventData(raw: unknown): EventData | null {
  const data = asObject(raw)
  if (data === null) return null
  const status = data['status']
  const endTime = data['endTime']
  const tags = Array.isArray(data['entityTags'])
    ? [
        ...new Set(
          data['entityTags'].flatMap((entry) => {
            const text = tagText(entry)
            return text === null ? [] : [text.slice(0, MAX_EVENT_TAG_LENGTH)]
          })
        )
      ].slice(0, MAX_EVENT_TAGS)
    : []
  const zones = Array.isArray(data['managementZones'])
    ? data['managementZones']
        .flatMap((entry) => {
          const zone = asObject(entry)
          const name = asString(zone?.['name']) ?? asString(zone?.['id'])
          return name === null ? [] : [name]
        })
        .slice(0, MAX_EVENT_ZONES)
    : []
  return {
    status: status === 'OPEN' || status === 'CLOSED' ? status : null,
    endTime: typeof endTime === 'number' && Number.isFinite(endTime) ? endTime : null,
    title: asString(data['title']),
    eventId: asString(data['eventId']),
    tags,
    managementZones: zones,
    flags: {
      maintenance: data['underMaintenance'] === true,
      frequent: data['frequentEvent'] === true,
      suppressed: data['suppressAlert'] === true || data['suppressProblem'] === true
    }
  }
}

export function toEvidenceWire(item: z.output<typeof evidenceItemSchema>): EvidenceWire {
  const isEvent = item.evidenceType === 'EVENT'
  const data = asObject(item.data)
  const properties = rawProperties(data)
  return {
    evidenceType: item.evidenceType,
    displayName: item.displayName,
    entity: toEvidenceEntity(item.entity),
    groupingEntity: toEvidenceEntity(item.groupingEntity),
    rootCauseRelevant: item.rootCauseRelevant ?? false,
    startTime: item.startTime ?? null,
    endTime: item.endTime ?? null,
    eventType: item.eventType ?? null,
    // En un EVENT, la descripción va en su campo y no ocupa sitio entre las 8.
    properties: properties
      .filter((property) => !isEvent || property.key !== DESCRIPTION_KEY)
      .slice(0, MAX_EVENT_PROPERTIES)
      .map((property) => ({ key: property.key, text: propertyText(property.value) })),
    metricId: item.metricId ?? null,
    unit: item.unit ?? null,
    valueBefore: item.valueBeforeChangePoint ?? null,
    valueAfter: item.valueAfterChangePoint ?? null,
    // Sobre las propiedades EN CRUDO: el selector no cabe en el recorte de arriba.
    eventMetric: isEvent ? eventMetricInfo(properties) : null,
    description: isEvent ? eventDescription(properties) : null,
    data: isEvent ? toEventData(item.data) : null
  }
}

/**
 * Detalle (GET /problems/{id} con fields=evidenceDetails,impactAnalysis,
 * recentComments). Las partes anidadas son tolerantes: evidence es polimórfico,
 * así que se valida lo que se muestra y se deja pasar el resto. Evidencias,
 * impactos y comentarios se validan uno a uno (parseItems): uno raro se
 * descarta y se cuenta, sin tumbar el detalle.
 */
export const problemDetailSchema = problemSchema.extend({
  entityTags: z
    .array(
      z.looseObject({
        key: z.string().optional(),
        value: z.string().optional(),
        stringRepresentation: z.string().optional()
      })
    )
    .optional(),
  linkedProblemInfo: z
    .looseObject({ displayId: z.string().optional(), problemId: z.string().optional() })
    .nullable()
    .optional(),
  evidenceDetails: z
    .looseObject({ details: z.array(z.unknown()).optional(), totalCount: z.number().optional() })
    .optional(),
  recentComments: z
    .looseObject({ comments: z.array(z.unknown()).optional(), totalCount: z.number().optional() })
    .optional()
})

export function toProblemDetail(problem: z.output<typeof problemDetailSchema>): ProblemDetail {
  const linked = problem.linkedProblemInfo
  const evidence = parseItems(evidenceItemSchema, problem.evidenceDetails?.details ?? [])
  const comments = parseItems(commentItemSchema, problem.recentComments?.comments ?? [])
  return {
    ...toProblemSummary(problem),
    entityTags: (problem.entityTags ?? []).flatMap((tag) => {
      if (tag.stringRepresentation !== undefined) return [tag.stringRepresentation]
      if (tag.key === undefined) return []
      return [tag.value === undefined ? tag.key : `${tag.key}:${tag.value}`]
    }),
    linkedProblem:
      linked === null || linked === undefined
        ? null
        : { displayId: linked.displayId ?? null, problemId: linked.problemId ?? null },
    evidence: evidence.items.map(toEvidenceWire),
    // El total de la API y lo que mandó de verdad (también lo ilegible): si el
    // total es mayor que lo recibido, la API ha recortado la lista. Lo ilegible
    // se avisa aparte (invalid) y no es un recorte.
    evidenceTotal: problem.evidenceDetails?.totalCount ?? null,
    evidenceReceived: problem.evidenceDetails?.details?.length ?? 0,
    comments: comments.items.map(toProblemComment),
    commentTotal: problem.recentComments?.totalCount ?? null,
    commentReceived: problem.recentComments?.comments?.length ?? 0,
    invalid: evidence.invalid + comments.invalid
  }
}

/** Comentario de un problema: solo la fecha es obligatoria; el resto, null si falta. */
export function toProblemComment(item: z.output<typeof commentItemSchema>): ProblemComment {
  return {
    author: item.authorName ?? null,
    content: item.content ?? '',
    context: item.context ?? null,
    createdAt: item.createdAtTimestamp
  }
}

export { commentItemSchema }
