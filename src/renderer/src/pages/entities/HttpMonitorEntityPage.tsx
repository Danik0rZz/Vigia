import type { JSX } from 'react'
import type { EntityPageProps } from './EntityPageFrame'
import { MonitorEntityPage } from './MonitorEntityPage'

/**
 * Página de análisis de una entidad HTTP_CHECK (HTTP monitor, ficha 0024): marcadores y gráficos
 * comunes con el browser monitor (`MonitorEntityPage`); el cuarto gráfico es el de los tiempos
 * HTTP (DNS, TCP, TLS y primer byte).
 */
export function HttpMonitorEntityPage(props: EntityPageProps): JSX.Element {
  return <MonitorEntityPage {...props} monitorKind="http" testId="entity-page-http_check" />
}
