import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { TIME_RANGES, useTimeRange } from '../app/time-range'

/** Selector del rango temporal global de la barra superior. */
export function TimeRangeSelector(): JSX.Element {
  const { t } = useTranslation()
  const selected = useTimeRange((state) => state.selected)
  const select = useTimeRange((state) => state.select)

  return (
    <ToggleGroup.Root
      type="single"
      value={selected}
      // Radix entrega '' al pulsar la opción ya marcada: siempre hay un rango elegido.
      onValueChange={(value) => {
        const range = TIME_RANGES.find((candidate) => candidate.id === value)
        if (range !== undefined) select(range.id)
      }}
      aria-label={t('timeRange.label')}
      data-testid="time-range"
      className="app-no-drag flex h-7 items-center rounded-md border border-border p-0.5"
    >
      {TIME_RANGES.map((range) => (
        <ToggleGroup.Item
          key={range.id}
          value={range.id}
          data-testid={`time-range-${range.id}`}
          className="h-full rounded px-2 text-xs text-muted-foreground hover:text-foreground data-[state=on]:bg-active data-[state=on]:text-foreground"
        >
          {t(range.labelKey)}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
