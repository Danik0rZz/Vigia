/**
 * Ruta de la página de análisis de una entidad (ficha 0003):
 * `/entities/:entityType/:entityId`. Los dos segmentos van con
 * `encodeURIComponent`: los tipos personalizados llevan `:` y un id puede traer
 * cualquier carácter. React Router los decodifica al leer los params.
 */
export const ENTITY_ROUTE = 'entities/:entityType/:entityId'

export function entityPath(type: string, id: string): string {
  return `/entities/${encodeURIComponent(type)}/${encodeURIComponent(id)}`
}

/** Cómo se llega desde el detalle del problema: "Volver" va atrás y el título es el nombre. */
export interface EntityLocationState {
  fromProblem?: boolean
  /** Nombre de la entidad tal como lo trae la evidencia; sin él, el título es el id. */
  name?: string
}
