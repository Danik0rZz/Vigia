import type { ComponentType } from 'react'
import { BrowserMonitorEntityPage } from './BrowserMonitorEntityPage'
import { CloudApplicationEntityPage } from './CloudApplicationEntityPage'
import type { EntityPageProps } from './EntityPageFrame'
import { DiskEntityPage } from './DiskEntityPage'
import type { EntityPageType } from './entity-page-types'
import { EnvironmentEntityPage } from './EnvironmentEntityPage'
import { GenericEntityPage } from './GenericEntityPage'
import { HostEntityPage } from './HostEntityPage'
import { HttpMonitorEntityPage } from './HttpMonitorEntityPage'
import { ProcessEntityPage } from './ProcessEntityPage'
import { ProcessGroupEntityPage } from './ProcessGroupEntityPage'
import { ServiceEntityPage } from './ServiceEntityPage'
import { WebApplicationEntityPage } from './WebApplicationEntityPage'

export { GenericEntityPage }

export interface EntityPageEntry {
  Page: ComponentType<EntityPageProps>
  /** Nombre del tipo en la interfaz (clave de `common`). */
  labelKey: string
}

/**
 * Tipo de entidad de Dynatrace → su página de análisis (ficha 0003). Añadir un
 * tipo es una entrada aquí, su página, su nombre en `entities.types` de es y en y el tipo en
 * `ENTITY_PAGE_TYPES` (`entity-page-types.ts`): el `satisfies` no compila si no coinciden.
 */
const PAGES = {
  HOST: { Page: HostEntityPage, labelKey: 'entities.types.HOST' },
  SERVICE: { Page: ServiceEntityPage, labelKey: 'entities.types.SERVICE' },
  PROCESS_GROUP_INSTANCE: {
    Page: ProcessEntityPage,
    labelKey: 'entities.types.PROCESS_GROUP_INSTANCE'
  },
  PROCESS_GROUP: { Page: ProcessGroupEntityPage, labelKey: 'entities.types.PROCESS_GROUP' },
  SYNTHETIC_TEST: { Page: BrowserMonitorEntityPage, labelKey: 'entities.types.SYNTHETIC_TEST' },
  HTTP_CHECK: { Page: HttpMonitorEntityPage, labelKey: 'entities.types.HTTP_CHECK' },
  APPLICATION: { Page: WebApplicationEntityPage, labelKey: 'entities.types.APPLICATION' },
  CLOUD_APPLICATION: {
    Page: CloudApplicationEntityPage,
    labelKey: 'entities.types.CLOUD_APPLICATION'
  },
  ENVIRONMENT: { Page: EnvironmentEntityPage, labelKey: 'entities.types.ENVIRONMENT' },
  DISK: { Page: DiskEntityPage, labelKey: 'entities.types.DISK' }
} satisfies Record<EntityPageType, EntityPageEntry>

export const ENTITY_PAGES: Readonly<Partial<Record<string, EntityPageEntry>>> = PAGES

/**
 * La página del tipo o, si no está en el registro, la genérica. Solo las claves
 * propias: `constructor` o `__proto__` no resuelven por el prototipo.
 */
export function entityPageFor(type: string): ComponentType<EntityPageProps> {
  const entry = Object.hasOwn(ENTITY_PAGES, type) ? ENTITY_PAGES[type] : undefined
  return entry?.Page ?? GenericEntityPage
}
