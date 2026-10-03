import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import * as Popover from '@radix-ui/react-popover'
import { ChevronDown } from 'lucide-react'
import { INPUT } from './styles'

/**
 * Filtro de clúster de Kubernetes: casillas con los clústeres de los problemas
 * ya cargados (varios = cualquiera de ellos). Es local: Dynatrace no permite
 * filtrar por clúster en problemSelector.
 */
export function ClusterFilter({
  options,
  selected,
  onChange
}: {
  options: readonly string[]
  selected: readonly string[]
  onChange: (next: string[]) => void
}): JSX.Element {
  const { t } = useTranslation()
  const toggle = (cluster: string, checked: boolean): void => {
    const next = checked ? [...selected, cluster] : selected.filter((value) => value !== cluster)
    onChange(options.filter((option) => next.includes(option)))
  }
  return (
    <div className="grid gap-1 text-xs text-muted-foreground">
      <span id="cluster-filter-label">{t('problems.filters.cluster')}</span>
      <Popover.Root>
        <Popover.Trigger
          data-testid="problems-filter-cluster"
          aria-labelledby="cluster-filter-label"
          title={t('problems.filters.clusterLocal')}
          className={`${INPUT} flex w-48 items-center justify-between gap-2 text-left text-foreground`}
        >
          <span className="truncate">
            {selected.length === 0
              ? t('problems.filters.clusterAll')
              : selected.length === 1
                ? selected[0]
                : t('problems.filters.clusterSome', { count: selected.length })}
          </span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="glass z-50 grid max-h-72 w-64 gap-0.5 overflow-y-auto rounded-lg p-2 text-sm"
          >
            <p className="px-1 pb-1 text-xs text-muted-foreground">
              {t('problems.filters.clusterLocal')}
            </p>
            {options.map((cluster) => (
              <label
                key={cluster}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-hover"
              >
                <input
                  type="checkbox"
                  data-testid="cluster-option"
                  value={cluster}
                  checked={selected.includes(cluster)}
                  onChange={(event) => toggle(cluster, event.target.checked)}
                  className="size-4 accent-[var(--accent)]"
                />
                <span className="truncate">{cluster}</span>
              </label>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
