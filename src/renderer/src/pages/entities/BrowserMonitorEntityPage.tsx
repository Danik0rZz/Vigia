import type { JSX } from 'react'
import type { EntityPageProps } from './EntityPageFrame'
import { MonitorEntityPage } from './MonitorEntityPage'

/**
 * Página de análisis de una entidad SYNTHETIC_TEST (browser monitor, ficha 0024): marcadores y
 * gráficos comunes con el HTTP monitor (`MonitorEntityPage`); el cuarto gráfico es el de
 * rendimiento (LCP, visually complete y speed index).
 */
export function BrowserMonitorEntityPage(props: EntityPageProps): JSX.Element {
  return <MonitorEntityPage {...props} monitorKind="browser" testId="entity-page-synthetic_test" />
}
