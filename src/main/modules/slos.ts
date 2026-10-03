import { z } from 'zod'
import { sloStatuses, type SloSummary } from '@shared/modules'

/** SLO de GET /api/v2/slo (solo los campos que usa la app). */
export const sloSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(sloStatuses),
  target: z.number(),
  warning: z.number(),
  evaluatedPercentage: z.number(),
  errorBudget: z.number(),
  error: z.string()
})

export const slosPageSchema = z.object({
  slo: z.array(sloSchema),
  totalCount: z.number(),
  nextPageKey: z.string().nullable().optional()
})

/** -1 significa "sin evaluar" o "error de cálculo" (ver `error`); "NONE", sin error. */
export function toSloSummary(slo: z.output<typeof sloSchema>): SloSummary {
  return {
    id: slo.id,
    name: slo.name,
    status: slo.status,
    target: slo.target,
    warning: slo.warning,
    evaluatedPercentage: slo.evaluatedPercentage === -1 ? null : slo.evaluatedPercentage,
    errorBudget: slo.errorBudget === -1 ? null : slo.errorBudget,
    error: slo.error === 'NONE' ? null : slo.error
  }
}
