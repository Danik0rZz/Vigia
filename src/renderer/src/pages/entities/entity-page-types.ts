/**
 * Tipos de entidad con página de análisis propia (ficha 0042). Está aparte de `registry.ts` para
 * que una página pueda saber si enlazar a otra entidad sin importar el registro (que importa
 * todas las páginas: sería un ciclo). `registry.ts` comprueba que coinciden con `ENTITY_PAGES`.
 */
export const ENTITY_PAGE_TYPES = [
  'HOST',
  'SERVICE',
  'PROCESS_GROUP_INSTANCE',
  'PROCESS_GROUP',
  'SYNTHETIC_TEST',
  'HTTP_CHECK',
  'APPLICATION',
  'CLOUD_APPLICATION',
  'ENVIRONMENT',
  'DISK'
] as const
export type EntityPageType = (typeof ENTITY_PAGE_TYPES)[number]

/** Si el tipo tiene página propia (si no, la entidad se enseña como texto, sin enlace). */
export function hasEntityPage(type: string): boolean {
  return (ENTITY_PAGE_TYPES as readonly string[]).includes(type)
}
