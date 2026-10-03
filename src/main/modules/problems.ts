import { z } from 'zod'
import {
  problemStatuses,
  type EntityRef,
  type ImpactLevel,
  type ProblemDetail,
  type ProblemSummary,
  type SeverityLevel
} from '@shared/modules'

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
  'k8s.namespace.name': z.array(z.string()).optional()
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
    namespaces: problem['k8s.namespace.name'] ?? []
  }
}

/** Entidad tolerante dentro de las partes anidadas: si falta, null. */
const looseEntitySchema = z
  .looseObject({
    entityId: z.looseObject({ id: z.string().optional() }).optional(),
    name: z.string().optional()
  })
  .optional()

const entityLabel = (entity: z.output<typeof looseEntitySchema>): string | null =>
  entity?.name ?? entity?.entityId?.id ?? null

/**
 * Detalle (GET /problems/{id} con fields=evidenceDetails,impactAnalysis,
 * recentComments). Las partes anidadas son tolerantes: evidence es polimórfico,
 * así que se valida lo que se muestra y se deja pasar el resto.
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
    .looseObject({
      details: z
        .array(
          z.looseObject({
            evidenceType: z.string().optional(),
            displayName: z.string().optional(),
            entity: looseEntitySchema,
            startTime: z.number().optional()
          })
        )
        .optional()
    })
    .optional(),
  impactAnalysis: z
    .looseObject({
      impacts: z
        .array(
          z.looseObject({
            impactType: z.string().optional(),
            impactedEntity: looseEntitySchema,
            estimatedAffectedUsers: z.number().optional()
          })
        )
        .optional()
    })
    .optional(),
  recentComments: z
    .looseObject({
      comments: z
        .array(
          z.looseObject({
            authorName: z.string().optional(),
            content: z.string().optional(),
            createdAtTimestamp: z.number().optional()
          })
        )
        .optional()
    })
    .optional()
})

export function toProblemDetail(problem: z.output<typeof problemDetailSchema>): ProblemDetail {
  const linked = problem.linkedProblemInfo
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
    evidence: (problem.evidenceDetails?.details ?? []).map((item) => ({
      type: item.evidenceType ?? 'UNKNOWN',
      name: item.displayName ?? '',
      entity: entityLabel(item.entity),
      startTime: item.startTime ?? null
    })),
    impacts: (problem.impactAnalysis?.impacts ?? []).map((item) => ({
      type: item.impactType ?? 'UNKNOWN',
      entity: entityLabel(item.impactedEntity),
      estimatedAffectedUsers: item.estimatedAffectedUsers ?? null
    })),
    comments: (problem.recentComments?.comments ?? []).map((item) => ({
      author: item.authorName ?? null,
      content: item.content ?? '',
      createdAt: item.createdAtTimestamp ?? null
    }))
  }
}
