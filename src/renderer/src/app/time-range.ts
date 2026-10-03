import { create } from 'zustand'

export type TimeRangeId = '2h' | '24h' | '7d'

export interface TimeRange {
  id: TimeRangeId
  /** Clave i18n de la etiqueta (`timeRange.options.<id>`). */
  labelKey: string
}

/**
 * Lista única de rangos temporales del selector global. El cálculo de
 * from/to y el rango "personalizado" llegan en la Fase 6, con los datos.
 */
export const TIME_RANGES: readonly TimeRange[] = (['2h', '24h', '7d'] as const).map((id) => ({
  id,
  labelKey: `timeRange.options.${id}`
}))

interface TimeRangeState {
  selected: TimeRangeId
  select: (id: TimeRangeId) => void
}

/** Rango activo. Es estado de trabajo, no una preferencia: no se guarda entre sesiones. */
export const useTimeRange = create<TimeRangeState>()((set) => ({
  selected: '2h',
  select: (selected) => set({ selected })
}))
