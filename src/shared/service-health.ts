import { severityRank, type ProblemSummary } from './modules'

export interface ServiceHealth {
  id: string
  name: string
  /** Peor severidad de sus problemas abiertos (SEVERITY_ORDER). */
  severity: string
  problems: number
}

/**
 * Servicios afectados por problemas abiertos, con su peor severidad, del más
 * grave al menos grave (sin endpoints nuevos: sale de la lista de problemas).
 */
export function serviceHealth(problems: readonly ProblemSummary[]): ServiceHealth[] {
  const services = new Map<string, ServiceHealth>()
  for (const problem of problems) {
    if (problem.status !== 'OPEN') continue
    for (const entity of problem.affectedEntities) {
      if (entity.type !== 'SERVICE') continue
      const current = services.get(entity.id)
      services.set(entity.id, {
        id: entity.id,
        name: entity.name ?? entity.id,
        severity:
          current === undefined ||
          severityRank(problem.severityLevel) < severityRank(current.severity)
            ? problem.severityLevel
            : current.severity,
        problems: (current?.problems ?? 0) + 1
      })
    }
  }
  return [...services.values()].sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
}
