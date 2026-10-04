import { create } from 'zustand'

interface ProblemClockState {
  /** "Ahora" de cada problema abierto, por `${envId}/${problemId}`. */
  times: Record<string, number>
  set: (key: string, time: number) => void
}

/**
 * El "ahora" con el que se calculan los rangos de los mini gráficos de un
 * problema. Se guarda al entrar por primera vez y solo cambia con
 * "Actualizar": volver al problema no pide datos (la caché tiene la misma
 * clave). Es estado de trabajo: no se guarda entre sesiones.
 */
export const useProblemClock = create<ProblemClockState>()((set) => ({
  times: {},
  set: (key, time) => set((state) => ({ times: { ...state.times, [key]: time } }))
}))
