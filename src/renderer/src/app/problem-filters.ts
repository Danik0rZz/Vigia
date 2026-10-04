import { create } from 'zustand'
import type { ImpactLevel, SeverityLevel } from '@shared/modules'
import { DEFAULT_PROBLEM_SORT, type ProblemSort } from '@shared/problem-sort'

export { DEFAULT_PROBLEM_SORT, type ProblemSort }

export type ProblemStatusFilter = 'all' | 'open' | 'closed'

export interface ProblemFilters {
  status: ProblemStatusFilter
  /** Texto tal como se escribe (la búsqueda lo aplica con un pequeño retardo). */
  text: string
  /** Clústeres del filtro local. */
  clusters: string[]
  /** Severidades e impactos: estos filtran en Dynatrace (problemSelector). */
  severity: SeverityLevel[]
  impact: ImpactLevel[]
}

/**
 * Lo que la lista necesita recuperar al volver del detalle: la página se
 * desmonta al ir a /problems/:id, así que vive aquí y no en la página.
 */
export interface ProblemListView {
  sort: ProblemSort
  /** Índice de la primera fila visible (no píxeles: la altura puede cambiar). */
  scrollIndex: number
  /** El último problema abierto, para devolverle el foco al volver. */
  lastOpened: string | null
}

export const DEFAULT_PROBLEM_FILTERS: ProblemFilters = {
  status: 'all',
  text: '',
  clusters: [],
  severity: [],
  impact: []
}

export const DEFAULT_PROBLEM_LIST_VIEW: ProblemListView = {
  sort: DEFAULT_PROBLEM_SORT,
  scrollIndex: 0,
  lastOpened: null
}

type ProblemState = ProblemFilters & ProblemListView
const DEFAULT_STATE: ProblemState = { ...DEFAULT_PROBLEM_FILTERS, ...DEFAULT_PROBLEM_LIST_VIEW }

interface ProblemFiltersState {
  /** Filtros y vista de cada entorno: al volver a uno se recuperan los suyos. */
  byEnv: Record<string, ProblemState>
  update: (envId: string, change: Partial<ProblemState>) => void
}

/**
 * Filtros y vista de Problemas fuera de la página, para que no se pierdan al
 * cambiar de sección o al abrir un problema (la página se desmonta). Van por
 * entorno: los clústeres o el texto de un entorno no tienen sentido en otro. Es
 * estado de trabajo: no se guarda entre sesiones.
 */
export const useProblemFiltersStore = create<ProblemFiltersState>()((set) => ({
  byEnv: {},
  update: (envId, change) =>
    set((state) => ({
      byEnv: {
        ...state.byEnv,
        [envId]: { ...(state.byEnv[envId] ?? DEFAULT_STATE), ...change }
      }
    }))
}))

/** Filtros y vista del entorno, con sus setters (sin entorno, los de por defecto). */
export function useProblemFilters(envId: string | null): ProblemState & {
  setStatus: (status: ProblemStatusFilter) => void
  setText: (text: string) => void
  setClusters: (clusters: string[]) => void
  setSeverity: (severity: SeverityLevel[]) => void
  setImpact: (impact: ImpactLevel[]) => void
  setSort: (sort: ProblemSort) => void
  setScrollIndex: (scrollIndex: number) => void
  setLastOpened: (problemId: string) => void
} {
  const key = envId ?? ''
  const state = useProblemFiltersStore((store) => store.byEnv[key]) ?? DEFAULT_STATE
  const update = useProblemFiltersStore((store) => store.update)
  return {
    ...state,
    setStatus: (status) => update(key, { status }),
    setText: (text) => update(key, { text }),
    setClusters: (clusters) => update(key, { clusters }),
    setSeverity: (severity) => update(key, { severity }),
    setImpact: (impact) => update(key, { impact }),
    setSort: (sort) => update(key, { sort }),
    setScrollIndex: (scrollIndex) => update(key, { scrollIndex }),
    setLastOpened: (lastOpened) => update(key, { lastOpened })
  }
}
