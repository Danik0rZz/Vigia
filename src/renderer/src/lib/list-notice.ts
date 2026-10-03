export interface ListNoticeInput {
  /** Filas que se ven (tras el filtro local). */
  shown: number
  /** Filas que han llegado de la API. */
  loaded: number
  /** Total según la API, o null si no lo da. */
  total: number | null
  /** La API tenía más de lo que se ha traído. */
  truncated: boolean
  /** Hay un filtro local activo (por ejemplo, el de clúster). */
  filtered: boolean
}

export interface ListNotice {
  key: string
  params: Record<string, number>
}

/**
 * Aviso bajo una lista: truncada por la API, filtrada en local o las dos
 * cosas. Devuelve la clave i18n y sus parámetros, o null si no hay nada que
 * decir. Con filtro local, siempre se dice cuántas se cargaron: el filtro no
 * busca en el servidor.
 */
export function listNotice({
  shown,
  loaded,
  total,
  truncated,
  filtered
}: ListNoticeInput): ListNotice | null {
  if (filtered) {
    if (!truncated) return { key: 'module.filteredOf', params: { shown, loaded } }
    return total === null
      ? { key: 'module.filteredOfFirst', params: { shown, loaded } }
      : { key: 'module.filteredOfTotal', params: { shown, loaded, total } }
  }
  if (!truncated) return null
  return total === null
    ? { key: 'module.truncated', params: { count: shown } }
    : { key: 'module.truncatedOf', params: { shown, total } }
}
