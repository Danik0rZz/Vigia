import type { ZodType } from 'zod'
import { useModuleAccess, useModuleRefresh, type ModuleAccess } from '../../data/modules'
import { useConnectionStatusKnown } from '../../data/tenants'

/*
 * Acceso común de las páginas de entidad (ficha 0058): el id validado, los accesos y entornos de
 * metrics, problems y entities, «Actualizar» y si ya se puede pedir. Antes, cada página copiaba
 * este bloque, con la espera de la ficha 0015 (`useConnectionStatusKnown` antes de pedir
 * `entities:get`).
 */

/** Lo que decide `resolveEntityPageAccess` con el id ya validado y los accesos de cada módulo. */
export interface EntityPageAccessInput {
  /** El id de la entidad si el esquema del tipo lo acepta; si no, `null` (no se pide nada). */
  id: string | null
  metrics: ModuleAccess
  problems: ModuleAccess
  entities: ModuleAccess
  /** Si ya se conoce `connection:status` (ficha 0015): hasta entonces no se sabe qué scope falta. */
  statusKnown: boolean
}

export interface EntityPageEnvs {
  metricsEnv: string | null
  problemsEnv: string | null
  /** `null` hasta conocer el estado de la conexión: sin él no se sabe si falta entities.read. */
  entitiesEnv: string | null
  /** Ya se sabe qué se puede pedir (estado de la conexión conocido) y hay algún módulo con acceso. */
  canFetch: boolean
  /**
   * Si la página enseña «Actualizar»: con algún módulo con acceso, sin esperar al estado de la
   * conexión (como antes de la ficha 0058: el botón sale en cuanto metrics o problems están
   * disponibles).
   */
  canRefresh: boolean
}

const envOf = (access: ModuleAccess): string | null => (access.available ? access.envId : null)

/** Lógica pura del acceso de una página de entidad (la usa `useEntityPageAccess`). */
export function resolveEntityPageAccess({
  id,
  metrics,
  problems,
  entities,
  statusKnown
}: EntityPageAccessInput): EntityPageEnvs {
  const metricsEnv = envOf(metrics)
  const problemsEnv = envOf(problems)
  const entitiesEnv = statusKnown ? envOf(entities) : null
  const anyAvailable = metricsEnv !== null || problemsEnv !== null || envOf(entities) !== null
  return {
    metricsEnv,
    problemsEnv,
    entitiesEnv,
    canFetch: id !== null && statusKnown && anyAvailable,
    canRefresh: id !== null && (metricsEnv !== null || problemsEnv !== null || entitiesEnv !== null)
  }
}

export interface EntityPageAccess extends EntityPageEnvs {
  id: string | null
  metricsAccess: ModuleAccess
  problemsAccess: ModuleAccess
  entitiesAccess: ModuleAccess
  /** Vuelve a pedir las consultas activas de la página (ADR-0004). */
  refresh: () => void
}

/**
 * El bloque de acceso de una página de entidad: un id que no pasa el esquema del tipo no llega a
 * main (el canal lo rechazaría igual). `extraEnvs`: entornos de otros módulos de la página (los
 * eventos del host, ficha 0042), que cuentan para «Actualizar» como los tres de siempre.
 */
export function useEntityPageAccess(
  rawId: string,
  schema: ZodType<string>,
  extraEnvs: readonly (string | null)[] = []
): EntityPageAccess {
  const id = schema.safeParse(rawId).success ? rawId : null
  const metricsAccess = useModuleAccess('metrics')
  const problemsAccess = useModuleAccess('problems')
  const entitiesAccess = useModuleAccess('entities')
  // Sin el resultado de la última prueba no se sabe si falta entities.read: hasta tenerlo, no se
  // pide. Los tres módulos son del entorno activo: vale el de cualquiera que tenga acceso.
  const statusKnown = useConnectionStatusKnown(
    envOf(entitiesAccess) ?? envOf(metricsAccess) ?? envOf(problemsAccess)
  )
  const envs = resolveEntityPageAccess({
    id,
    metrics: metricsAccess,
    problems: problemsAccess,
    entities: entitiesAccess,
    statusKnown
  })
  const extraEnv = extraEnvs.find((env) => env !== null) ?? null
  const refresh = useModuleRefresh(
    envs.metricsEnv ?? envs.problemsEnv ?? envs.entitiesEnv ?? extraEnv,
    'entities'
  )
  return {
    ...envs,
    canRefresh: envs.canRefresh || (id !== null && extraEnv !== null),
    id,
    metricsAccess,
    problemsAccess,
    entitiesAccess,
    refresh
  }
}
