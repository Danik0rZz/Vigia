import { useState, type FormEvent, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import * as Popover from '@radix-ui/react-popover'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { timeRangeSchema } from '@shared/time-range'
import { TIME_RANGES, useTimeRange } from '../app/time-range'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT } from './styles'

/** `datetime-local` (hora local, sin zona) → ISO; null si está vacío o no es válido. */
function localToIso(value: string): string | null {
  if (value === '') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** ISO → valor de un input `datetime-local` en hora local. */
function isoToLocal(iso: string): string {
  const date = new Date(iso)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function CustomRangeForm({ onDone }: { onDone: () => void }): JSX.Element {
  const { t } = useTranslation()
  const current = useTimeRange((state) => state.custom)
  const setCustom = useTimeRange((state) => state.setCustom)
  const [from, setFrom] = useState(current === null ? '' : isoToLocal(current.from))
  const [to, setTo] = useState(current === null ? '' : isoToLocal(current.to))
  const [invalid, setInvalid] = useState(false)

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    const range = { from: localToIso(from), to: localToIso(to) }
    const parsed = timeRangeSchema.safeParse(range)
    if (!parsed.success || typeof parsed.data === 'string') {
      setInvalid(true)
      return
    }
    setCustom(parsed.data)
    onDone()
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3" noValidate>
      <p className="text-sm font-semibold">{t('customRange.title')}</p>
      <label className="grid gap-1 text-xs text-muted-foreground">
        {t('customRange.from')}
        <input
          type="datetime-local"
          data-testid="custom-range-from"
          value={from}
          aria-invalid={invalid || undefined}
          onChange={(event) => setFrom(event.target.value)}
          className={INPUT}
        />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        {t('customRange.to')}
        <input
          type="datetime-local"
          data-testid="custom-range-to"
          value={to}
          aria-invalid={invalid || undefined}
          onChange={(event) => setTo(event.target.value)}
          className={INPUT}
        />
      </label>
      {invalid && (
        <p role="alert" className="text-xs text-danger">
          {t('customRange.invalid')}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          data-testid="form-cancel"
          onClick={onDone}
          className={BUTTON_SECONDARY}
        >
          {t('form.cancel')}
        </button>
        <button type="submit" data-testid="form-save" className={BUTTON_PRIMARY}>
          {t('form.save')}
        </button>
      </div>
    </form>
  )
}

/**
 * Selector del rango temporal global de la barra superior. "Personalizado"
 * abre un formulario con las fechas; solo queda seleccionado al guardarlas.
 */
export function TimeRangeSelector(): JSX.Element {
  const { t } = useTranslation()
  const selected = useTimeRange((state) => state.selected)
  const select = useTimeRange((state) => state.select)
  const [customOpen, setCustomOpen] = useState(false)

  return (
    <Popover.Root open={customOpen} onOpenChange={setCustomOpen}>
      <Popover.Anchor asChild>
        <ToggleGroup.Root
          type="single"
          value={selected}
          // Radix entrega '' al pulsar la opción ya marcada: siempre hay un rango elegido.
          onValueChange={(value) => {
            const range = TIME_RANGES.find((candidate) => candidate.id === value)
            if (range !== undefined && range.id !== 'custom') select(range.id)
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
              onClick={range.id === 'custom' ? () => setCustomOpen(true) : undefined}
              className="h-full rounded px-2 text-xs text-muted-foreground hover:text-foreground data-[state=on]:bg-active data-[state=on]:text-foreground"
            >
              {t(range.labelKey)}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          data-testid="custom-range"
          align="end"
          sideOffset={6}
          className="glass z-50 w-72 rounded-lg p-4"
        >
          <CustomRangeForm onDone={() => setCustomOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
