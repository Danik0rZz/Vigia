import { create } from 'zustand'
import type { CustomTimeRange, PresetTimeRange, TimeRangeValue } from '@shared/time-range'

export type TimeRangeId = PresetTimeRange | 'custom'

export interface TimeRange {
  id: TimeRangeId
  /** Clave i18n de la etiqueta (`timeRange.options.<id>`). */
  labelKey: string
}

/** Lista única de rangos temporales del selector global. */
export const TIME_RANGES: readonly TimeRange[] = (['2h', '24h', '7d', 'custom'] as const).map(
  (id) => ({ id, labelKey: `timeRange.options.${id}` })
)

interface TimeRangeState {
  selected: TimeRangeId
  /** Fechas del rango personalizado; solo se selecciona "custom" cuando las hay. */
  custom: CustomTimeRange | null
  select: (id: TimeRangeId) => void
  setCustom: (range: CustomTimeRange) => void
}

/** Rango activo. Es estado de trabajo, no una preferencia: no se guarda entre sesiones. */
export const useTimeRange = create<TimeRangeState>()((set) => ({
  selected: '2h',
  custom: null,
  select: (selected) => set({ selected }),
  setCustom: (custom) => set({ custom, selected: 'custom' })
}))

/** Rango que usan las vistas: el preset o las fechas del personalizado. */
export function useTimeRangeValue(): TimeRangeValue {
  const selected = useTimeRange((state) => state.selected)
  const custom = useTimeRange((state) => state.custom)
  if (selected !== 'custom') return selected
  return custom ?? '2h'
}
