import { create } from 'zustand'

export type ProblemStatusFilter = 'all' | 'open' | 'closed'

interface ProblemFiltersState {
  status: ProblemStatusFilter
  /** Texto tal como se escribe (la búsqueda lo aplica con un pequeño retardo). */
  text: string
  /** Clústeres del filtro local. */
  clusters: string[]
  setStatus: (status: ProblemStatusFilter) => void
  setText: (text: string) => void
  setClusters: (clusters: string[]) => void
}

/**
 * Filtros de Problemas fuera de la página, para que no se pierdan al cambiar
 * de sección (la página se desmonta). Es estado de trabajo: no se guarda entre
 * sesiones.
 */
export const useProblemFilters = create<ProblemFiltersState>()((set) => ({
  status: 'all',
  text: '',
  clusters: [],
  setStatus: (status) => set({ status }),
  setText: (text) => set({ text }),
  setClusters: (clusters) => set({ clusters })
}))
