import { useId, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import * as Popover from '@radix-ui/react-popover'
import { ChevronDown } from 'lucide-react'
import { INPUT } from './styles'

export interface FilterOption {
  value: string
  label: string
}

/**
 * Filtro de selección múltiple en un desplegable con casillas (varias = OR).
 * Sin nada marcado no filtra ("Todos").
 */
export function MultiFilter({
  label,
  testId,
  optionTestId,
  options,
  selected,
  onChange,
  hint
}: {
  label: string
  /** data-testid del botón que abre el desplegable. */
  testId: string
  /** data-testid de cada casilla (con value = el valor de la opción). */
  optionTestId: string
  options: readonly FilterOption[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  /** Aclaración opcional (por ejemplo, que el filtro es local). */
  hint?: string | undefined
}): JSX.Element {
  const { t } = useTranslation()
  const labelId = useId()
  const toggle = (value: string, checked: boolean): void => {
    const next = checked ? [...selected, value] : selected.filter((item) => item !== value)
    // Mismo orden que las opciones, sin duplicados.
    onChange(options.map((option) => option.value).filter((item) => next.includes(item)))
  }
  const summary =
    selected.length === 0
      ? t('problems.filters.all')
      : selected.length === 1
        ? (options.find((option) => option.value === selected[0])?.label ?? selected[0])
        : t('problems.filters.someSelected', { count: selected.length })

  return (
    <div className="grid gap-1 text-xs text-muted-foreground">
      <span id={labelId}>{label}</span>
      <Popover.Root>
        <Popover.Trigger
          data-testid={testId}
          aria-labelledby={labelId}
          title={hint}
          className={`${INPUT} flex w-48 items-center justify-between gap-2 text-left text-foreground`}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="glass z-50 grid max-h-72 w-64 gap-0.5 overflow-y-auto rounded-lg p-2 text-sm"
          >
            {hint !== undefined && (
              <p className="px-1 pb-1 text-xs text-muted-foreground">{hint}</p>
            )}
            {options.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-hover"
              >
                <input
                  type="checkbox"
                  data-testid={optionTestId}
                  value={option.value}
                  checked={selected.includes(option.value)}
                  onChange={(event) => toggle(option.value, event.target.checked)}
                  className="size-4 accent-[var(--accent)]"
                />
                <span className="truncate">{option.label}</span>
              </label>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
