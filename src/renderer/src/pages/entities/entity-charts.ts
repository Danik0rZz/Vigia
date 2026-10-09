import { timeRangeToDates, type TimeRangeValue } from '@shared/time-range'
import type { ChartColors } from '../../components/Chart'

/** Piezas sin React de los gráficos de las páginas de entidad (servicio y host). */

/** Rango visible del gráfico, en ms desde epoch. */
export type VisibleRange = { from: number; to: number }

/** Rango que se ve (ms desde epoch); el relativo, contado desde `at`. */
export function visibleRange(timeRange: TimeRangeValue, at: number): VisibleRange {
  const dates = timeRangeToDates(timeRange, new Date(at))
  return { from: dates.from.getTime(), to: dates.to.getTime() }
}

/** Sin colores: para sacar solo los nombres y los puntos de las series. */
export const NO_COLORS: ChartColors = {
  foreground: '',
  muted: '',
  border: '',
  accent: '',
  background: '',
  danger: '',
  success: '',
  series2: '',
  series3: '',
  series4: '',
  series5: ''
}
