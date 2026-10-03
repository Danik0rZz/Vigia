import type { TFunction } from 'i18next'

/**
 * Avisos sobre los datos, ya traducidos: elementos descartados por no cumplir
 * el esquema y los `warnings` de Dynatrace. Los usan la vista (ApiWarnings) y
 * la hoja Info de la exportación.
 */
export function dataWarnings(
  t: TFunction,
  invalid: number,
  warnings: readonly string[] = []
): string[] {
  return [...(invalid > 0 ? [t('module.invalidItems', { count: invalid })] : []), ...warnings]
}
