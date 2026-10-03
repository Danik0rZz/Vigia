import { z } from 'zod'
import {
  impactLevels,
  problemStatuses,
  severityLevels,
  type EntityRef,
  type ImpactLevel,
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

const entityStubSchema = z.object({
  entityId: z.object({ id: z.string(), type: z.string() }),
  name: z.string().optional()
})

/** Problem de la API v2 (solo los campos que usa la app). */
export const problemSchema = z.object({
  problemId: z.string(),
  displayId: z.string(),
  title: z.string(),
  status: z.enum(problemStatuses),
  severityLevel: z.enum(severityLevels),
  impactLevel: z.enum(impactLevels),
  startTime: z.number(),
  endTime: z.number(),
  affectedEntities: z.array(entityStubSchema),
  impactedEntities: z.array(entityStubSchema),
  rootCauseEntity: entityStubSchema.nullable().optional(),
  managementZones: z.array(z.object({ id: z.string(), name: z.string() }))
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
    managementZones: problem.managementZones.map((zone) => zone.name)
  }
}
