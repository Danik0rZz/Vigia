import type { MonitorKind, MonitorMetricsResult } from '@shared/modules'
import { mergeMeta, seriesAt, singleValue } from './metric-series'
import type { MetricData } from './metrics'

/**
 * Métricas de un browser monitor (SYNTHETIC_TEST) o de un HTTP monitor
 * (HTTP_CHECK), ficha 0022, canal `entities:monitorMetrics`. Lo observado en vivo
 * (paso 0 de la ficha 0022, tabla en su "Verificación"):
 * - con `entitySelector=entityId("<id>")` cada expresión de abajo (exactamente
 *   la probada) vuelve con una sola serie, en el orden pedido: se casan por
 *   posición, como en el servicio y el host. En browser, solo
 *   `availability.location.total` lleva `splitBy` (va por región); las demás se
 *   probaron sin él. En HTTP, todas lo llevan;
 * - las de localización (`availability.location.total` y las `*.geo` de HTTP)
 *   traen una serie por localización (o región) si no se juntan con `splitBy`;
 * - la disponibilidad llega en % (0–100) y los tiempos en ms;
 * - `http.resultStatus` trae una serie por «Result status»: se filtra por SUCCESS y
 *   FAILURE y se suma; sin fallos, la de FAILURE llega sin series;
 * - `http.duration.geo` no tiene mediana (`:median` da lo mismo que `:avg`);
 * - con `resolution=Inf`, `:avg` y `:median` dan el valor del rango y los
 *   recuentos, la suma de la serie (sin `fold`: juntos dan 400).
 */

const B = 'builtin:synthetic.browser.'
const H = 'builtin:synthetic.http.'

/** El tipo sale del prefijo del id (ya validado por `monitorEntityIdSchema`). */
export function monitorKind(entityId: string): MonitorKind {
  return entityId.startsWith('HTTP_CHECK-') ? 'http' : 'browser'
}

/**
 * entitySelector que acota las dos consultas al monitor. El id ya viene validado
 * (tipo y 16 hexadecimales): no puede cerrar la comilla ni el paréntesis.
 */
export function monitorEntitySelector(entityId: string): string {
  return `entityId("${entityId}")`
}

/** Junta localizaciones, regiones o estados en una sola serie del monitor. */
const BROWSER_SPLIT = ':splitBy("dt.entity.synthetic_test")'
const HTTP_SPLIT = ':splitBy("dt.entity.http_check")'

const httpStatus = (value: 'SUCCESS' | 'FAILURE'): string =>
  `${H}resultStatus:filter(eq("Result status","${value}"))${HTTP_SPLIT}:sum`

/**
 * Consulta 1 (series), por tipo y en este orden: disponibilidad, duración,
 * correctas, fallidas y los cuatro de rendimiento (browser) o de tiempos (HTTP).
 */
const SERIES: Record<MonitorKind, string[]> = {
  browser: [
    `${B}availability.location.total${BROWSER_SPLIT}:avg`,
    `${B}totalDuration:avg`,
    `${B}success`,
    `${B}failure`,
    `${B}largestContentfulPaint.load:avg`,
    `${B}visuallyComplete.load:avg`,
    `${B}cumulativeLayoutShift.load:avg`,
    `${B}speedIndex.load:avg`
  ],
  http: [
    `${H}availability.location.total${HTTP_SPLIT}:avg`,
    `${H}duration.geo${HTTP_SPLIT}:avg`,
    httpStatus('SUCCESS'),
    httpStatus('FAILURE'),
    `${H}dns.geo${HTTP_SPLIT}:avg`,
    `${H}tcpConnectTime.geo${HTTP_SPLIT}:avg`,
    `${H}tlsHandshakeTime.geo${HTTP_SPLIT}:avg`,
    `${H}timeToFirstByte.geo${HTTP_SPLIT}:avg`
  ]
}

/**
 * Consulta 2 (marcadores, con `resolution=Inf`), en este orden: disponibilidad,
 * duración media, correctas, fallidas y, solo en browser, la mediana de la duración.
 */
const MARKERS: Record<MonitorKind, string[]> = {
  browser: [
    `${B}availability.location.total${BROWSER_SPLIT}:avg`,
    `${B}totalDuration:avg`,
    `${B}success`,
    `${B}failure`,
    `${B}totalDuration:median`
  ],
  http: [
    `${H}availability.location.total${HTTP_SPLIT}:avg`,
    `${H}duration.geo${HTTP_SPLIT}:avg`,
    httpStatus('SUCCESS'),
    httpStatus('FAILURE')
  ]
}

export function monitorSeriesSelector(kind: MonitorKind): string {
  return SERIES[kind].join(',')
}

export function monitorMarkerSelector(kind: MonitorKind): string {
  return MARKERS[kind].join(',')
}

/** Junta las dos respuestas en series y totales por papel para la interfaz. */
export function toMonitorMetrics(
  kind: MonitorKind,
  series: MetricData,
  markers: MetricData
): MonitorMetricsResult {
  return {
    kind,
    resolution: series.resolution,
    series: {
      availability: seriesAt(series, 0),
      duration: seriesAt(series, 1),
      executions: { ok: seriesAt(series, 2), failed: seriesAt(series, 3) },
      performance:
        kind === 'browser'
          ? {
              largestContentfulPaint: seriesAt(series, 4),
              visuallyComplete: seriesAt(series, 5),
              cumulativeLayoutShift: seriesAt(series, 6),
              speedIndex: seriesAt(series, 7)
            }
          : null,
      httpTimings:
        kind === 'http'
          ? {
              dns: seriesAt(series, 4),
              tcpConnect: seriesAt(series, 5),
              tlsHandshake: seriesAt(series, 6),
              timeToFirstByte: seriesAt(series, 7)
            }
          : null
    },
    totals: {
      availability: singleValue(markers, 0),
      duration: {
        avg: singleValue(markers, 1),
        // HTTP no tiene mediana (paso 0): se queda en null.
        median: kind === 'browser' ? singleValue(markers, 4) : null
      },
      // Sin dato, 0 (como los recuentos del servicio).
      executions: { ok: singleValue(markers, 2) ?? 0, failed: singleValue(markers, 3) ?? 0 }
    },
    ...mergeMeta([series, markers])
  }
}
