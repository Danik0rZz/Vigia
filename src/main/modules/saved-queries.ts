import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { SavedQuery } from '@shared/modules'
import type { AppDatabase } from '../db/database'
import { environments, savedMetricQueries } from '../db/schema'
import { DomainError } from '../errors'

export interface SavedQueryInput {
  /** Sin id se crea; con id se actualiza. */
  id?: string | undefined
  name: string
  metricSelector: string
  resolution?: string | null | undefined
}

export interface SavedQueryStore {
  list(envId: string): SavedQuery[]
  save(envId: string, input: SavedQueryInput): SavedQuery
  /** Idempotente. */
  delete(id: string): void
}

const sameName = (a: string, b: string): boolean =>
  a.toLocaleLowerCase('es') === b.toLocaleLowerCase('es')

/** Consultas de métricas guardadas por entorno; se borran con el entorno. */
export function createSavedQueryStore(db: AppDatabase): SavedQueryStore {
  function list(envId: string): SavedQuery[] {
    return db
      .select()
      .from(savedMetricQueries)
      .where(eq(savedMetricQueries.environmentId, envId))
      .all()
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }

  return {
    list,

    save(envId, input) {
      const environment = db
        .select({ id: environments.id })
        .from(environments)
        .where(eq(environments.id, envId))
        .get()
      if (environment === undefined)
        throw new DomainError('NOT_FOUND', 'El entorno no existe.', { key: 'environmentMissing' })

      const existing = list(envId)
      if (input.id !== undefined && !existing.some((query) => query.id === input.id)) {
        throw new DomainError('NOT_FOUND', 'La consulta guardada no existe.', {
          key: 'savedQueryMissing'
        })
      }
      if (existing.some((query) => query.id !== input.id && sameName(query.name, input.name))) {
        throw new DomainError('CONFLICT', 'Ya hay una consulta guardada con ese nombre.', {
          key: 'savedQueryNameTaken'
        })
      }

      const query: SavedQuery = {
        id: input.id ?? randomUUID(),
        environmentId: envId,
        name: input.name.trim(),
        metricSelector: input.metricSelector.trim(),
        resolution: input.resolution ?? null
      }
      db.insert(savedMetricQueries)
        .values(query)
        .onConflictDoUpdate({
          target: savedMetricQueries.id,
          set: {
            name: query.name,
            metricSelector: query.metricSelector,
            resolution: query.resolution
          }
        })
        .run()
      return query
    },

    delete(id) {
      db.delete(savedMetricQueries).where(eq(savedMetricQueries.id, id)).run()
    }
  }
}
