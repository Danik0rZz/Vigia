import { create } from 'zustand'
import {
  DEFAULT_EVIDENCE_SORT,
  EMPTY_EVIDENCE_FILTERS,
  type EvidenceFilters,
  type EvidenceSort
} from '@shared/problem-evidence'

/** Lo que la tabla de evidencias de un problema recupera al volver a él. */
export interface EvidenceTableState {
  filters: EvidenceFilters
  sort: EvidenceSort
  /** Ids (EvidenceView.id) de las filas desplegadas. */
  expanded: string[]
}

/** Problemas cuyo estado se recuerda; al pasar, sale el usado hace más tiempo. */
export const EVIDENCE_TABLE_LIMIT = 20

export const INITIAL_EVIDENCE_TABLE: EvidenceTableState = {
  filters: EMPTY_EVIDENCE_FILTERS,
  sort: DEFAULT_EVIDENCE_SORT,
  expanded: []
}

export const evidenceTableKey = (envId: string, problemId: string): string =>
  `${envId}:${problemId}`

interface EvidenceTableStore {
  tables: Record<string, EvidenceTableState>
  /** Claves por uso: la más reciente al final. */
  order: string[]
  /** El estado de un problema (o el inicial). No cuenta como uso. */
  get: (key: string) => EvidenceTableState
  /** Marca el problema como el más reciente (al abrirlo). */
  touch: (key: string) => void
  update: (key: string, patch: Partial<EvidenceTableState>) => void
  toggleExpanded: (key: string, id: string) => void
}

/** Pone la clave al final con su estado nuevo y recorta a EVIDENCE_TABLE_LIMIT. */
function withEntry(
  state: Pick<EvidenceTableStore, 'tables' | 'order'>,
  key: string,
  entry: EvidenceTableState
): Pick<EvidenceTableStore, 'tables' | 'order'> {
  const order = [...state.order.filter((item) => item !== key), key]
  const tables = { ...state.tables, [key]: entry }
  while (order.length > EVIDENCE_TABLE_LIMIT) {
    const oldest = order.shift()
    if (oldest !== undefined) delete tables[oldest]
  }
  return { tables, order }
}

/**
 * Filtros, orden y filas desplegadas de la tabla de evidencias por entorno y
 * problema. En memoria y solo de los últimos 20 problemas: volver a uno de
 * ellos lo deja como estaba; uno nuevo (o uno expulsado) empieza limpio.
 */
export const useEvidenceTableStore = create<EvidenceTableStore>()((set, get) => ({
  tables: {},
  order: [],
  get: (key) => get().tables[key] ?? INITIAL_EVIDENCE_TABLE,
  touch: (key) =>
    set((state) => withEntry(state, key, state.tables[key] ?? { ...INITIAL_EVIDENCE_TABLE })),
  update: (key, patch) =>
    set((state) =>
      withEntry(state, key, { ...(state.tables[key] ?? INITIAL_EVIDENCE_TABLE), ...patch })
    ),
  toggleExpanded: (key, id) =>
    set((state) => {
      const current = state.tables[key] ?? INITIAL_EVIDENCE_TABLE
      const expanded = current.expanded.includes(id)
        ? current.expanded.filter((item) => item !== id)
        : [...current.expanded, id]
      return withEntry(state, key, { ...current, expanded })
    })
}))
