import type { ConnectionReport } from '@shared/dynatrace'

/** Último resultado de "Probar conexión" por entorno, solo en memoria. */
export interface ConnectionStatusStore {
  get(envId: string): ConnectionReport | null
  set(envId: string, report: ConnectionReport): void
  clear(envId: string): void
}

export function createConnectionStatusStore(): ConnectionStatusStore {
  const reports = new Map<string, ConnectionReport>()
  return {
    get: (envId) => reports.get(envId) ?? null,
    set: (envId, report) => {
      reports.set(envId, report)
    },
    clear: (envId) => {
      reports.delete(envId)
    }
  }
}
