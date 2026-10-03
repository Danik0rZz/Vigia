import type { JSX } from 'react'
import * as RadioGroup from '@radix-ui/react-radio-group'

export interface Option<T extends string> {
  value: T
  label: string
}

/** Grupo de opciones excluyentes (radios accesibles de Radix) con el aspecto del tema. */
export function OptionGroup<T extends string>({
  value,
  options,
  onChange,
  labelledBy,
  testIdPrefix
}: {
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
  labelledBy: string
  testIdPrefix: string
}): JSX.Element {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next)
        if (option !== undefined) onChange(option.value)
      }}
      aria-labelledby={labelledBy}
      orientation="horizontal"
      className="flex flex-wrap gap-2"
    >
      {options.map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 hover:bg-hover has-data-[state=checked]:bg-active"
        >
          <RadioGroup.Item
            value={option.value}
            data-testid={`${testIdPrefix}-${option.value}`}
            className="flex size-4 items-center justify-center rounded-full border border-muted-foreground data-[state=checked]:border-accent"
          >
            <RadioGroup.Indicator className="size-2 rounded-full bg-accent" />
          </RadioGroup.Item>
          {option.label}
        </label>
      ))}
    </RadioGroup.Root>
  )
}
