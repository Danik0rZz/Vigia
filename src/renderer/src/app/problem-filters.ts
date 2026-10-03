import { create } from 'zustand'

export type ProblemStatusFilter = 'all' | 'open' | 'closed'

export interface ProblemFilters {
  status: ProblemStatusFilter
  /** Texto tal como se escribe (la búsqueda lo aplica con un pequeño retardo). */
  text: string
  /** Clústeres del filtro local. */
  clusters: string[]
}

export const DEFAULT_PROBLEM_FILTERS: ProblemFilters = { status: 'all', text: '', clusters: [] }

interface ProblemFiltersState {
  /** Filtros de cada entorno: al volver a uno se recuperan los suyos. */
  byEnv: Record<string, ProblemFilters>
  update: (envId: string, change: Partial<ProblemFilters>) => void
}

/**
 * Filtros de Problemas fuera de la página, para que no se pierdan al cambiar
 * de sección (la página se desmonta). Van por entorno: los clústeres o el
 * texto de un entorno no tienen sentido en otro. Es estado de trabajo: no se
 * guarda entre sesiones.
 */
export const useProblemFiltersStore = create<ProblemFiltersState>()((set) => ({
  byEnv: {},
  update: (envId, change) =>
    set((state) => ({
      byEnv: {
        ...state.byEnv,
        [envId]: { ...(state.byEnv[envId] ?? DEFAULT_PROBLEM_FILTERS), ...change }
      }
    }))
}))

/** Filtros del entorno y sus setters (sin entorno, los de por defecto). */
export function useProblemFilters(envId: string | null): ProblemFilters & {
  setStatus: (status: ProblemStatusFilter) => void
  setText: (text: string) => void
  setClusters: (clusters: string[]) => void
} {
  const key = envId ?? ''
  const filters = useProblemFiltersStore((state) => state.byEnv[key]) ?? DEFAULT_PROBLEM_FILTERS
  const update = useProblemFiltersStore((state) => state.update)
  return {
    ...filters,
    setStatus: (status) => update(key, { status }),
    setText: (text) => update(key, { text }),
    setClusters: (clusters) => update(key, { clusters })
  }
}
