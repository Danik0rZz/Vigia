import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { MultiFilter } from './MultiFilter'

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
  return (
    <MultiFilter
      label={t('problems.filters.cluster')}
      testId="problems-filter-cluster"
      optionTestId="cluster-option"
      options={options.map((cluster) => ({ value: cluster, label: cluster }))}
      selected={selected}
      onChange={onChange}
      hint={t('problems.filters.clusterLocal')}
    />
  )
}
