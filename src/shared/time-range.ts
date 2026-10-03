import { z } from 'zod'

/** Rangos fijos del selector global de la barra superior. */
export const presetTimeRanges = ['2h', '24h', '7d'] as const
export type PresetTimeRange = (typeof presetTimeRanges)[number]

/** Rango personalizado, con fechas ISO. */
export interface CustomTimeRange {
  from: string
  to: string
}

export type TimeRangeValue = PresetTimeRange | CustomTimeRange

const PRESET_MS: Record<PresetTimeRange, number> = {
  '2h': 2 * 3_600_000,
  '24h': 24 * 3_600_000,
  '7d': 7 * 24 * 3_600_000
}

/** Tramo máximo de un rango personalizado. */
export const MAX_CUSTOM_RANGE_MS = 365 * 24 * 3_600_000

export const timeRangeSchema = z.union([
  z.enum(presetTimeRanges),
  z
    .object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
    .refine(({ from, to }) => Date.parse(from) < Date.parse(to), 'from tiene que ser anterior a to')
    .refine(
      ({ from, to }) => Date.parse(to) - Date.parse(from) <= MAX_CUSTOM_RANGE_MS,
      'El rango no puede pasar de un año'
    )
])

/**
 * Rango en el formato de la API v2: relativo (`now-2h`, sin `to` = ahora) o, si
 * es personalizado, con fechas ISO.
 */
export function timeRangeToDt(range: TimeRangeValue): { from: string; to?: string } {
  if (typeof range === 'string') return { from: `now-${range}` }
  return { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() }
}

/** Fechas absolutas del rango en un momento dado (para la hoja Info de una exportación). */
export function timeRangeToDates(range: TimeRangeValue, now: Date): { from: Date; to: Date } {
  if (typeof range !== 'string') return { from: new Date(range.from), to: new Date(range.to) }
  return { from: new Date(now.getTime() - PRESET_MS[range]), to: new Date(now.getTime()) }
}
