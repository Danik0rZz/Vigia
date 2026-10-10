import { describe, expect, it, vi } from 'vitest'
import type { DtClient } from '../../dynatrace/client'
import { DtError } from '../../dynatrace/errors'
import { DomainError } from '../../errors'
import { metricDataSchema, type MetricData } from '../../modules/metrics'
import { createMetricsQuery, rethrowRejected } from './metrics-query'

/**
 * Ficha 0057: lo común de los canales de métricas de entidad en el handler.
 *
 * Decisiones del test-writer (delegadas y refinables; en la ficha):
 * - viven en `src/main/ipc/handlers/metrics-query.ts`;
 * - `createMetricsQuery(client, envId, range)` devuelve `query(metricSelector, resolution?)`,
 *   que pide `GET /metrics/query` (API clásica, Environment API v2) con `metricSelector`,
 *   `resolution` y todo lo que traiga `range` (el `from`/`to` de `timeRangeToDt`, y el
 *   `entitySelector` del canal si lo tiene), validado con `metricDataSchema`;
 * - `rethrowRejected(error, reasonKey)` siempre lanza: un `DtError` `BAD_REQUEST` o
 *   `NOT_FOUND` sale con el mismo código, mensaje y estado y `reason`
 *   `{ key: reasonKey, params: { status, detail } }` (status 0 si no llega); el resto, tal cual.
 */

const ENV_ID = '11111111-1111-4111-8111-111111111111'
const RANGE = { from: '2026-10-03T08:00:00.000Z', to: '2026-10-03T09:00:00.000Z' }
const EMPTY: MetricData = { resolution: '1m', totalCount: 0, result: [] }

function fakeClient(): { client: DtClient; dtRequest: ReturnType<typeof vi.fn> } {
  const dtRequest = vi.fn().mockResolvedValue(EMPTY)
  return { client: { dtRequest } as unknown as DtClient, dtRequest }
}

/** Ejecuta `action` y devuelve lo que lance. */
function thrown(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('se esperaba que lanzara')
}

describe('CA2 (0057): createMetricsQuery', () => {
  it('pide /metrics/query a la API clásica con el selector, la resolución y el rango', async () => {
    const { client, dtRequest } = fakeClient()
    const query = createMetricsQuery(client, ENV_ID, RANGE)
    await expect(query('builtin:host.cpu.usage:max', 'Inf')).resolves.toEqual(EMPTY)
    expect(dtRequest).toHaveBeenCalledTimes(1)
    const options = dtRequest.mock.calls[0]?.[0]
    expect(options).toMatchObject({ envId: ENV_ID, api: 'classic', path: '/metrics/query' })
    expect(options.schema).toBe(metricDataSchema)
    expect(options.query).toMatchObject({
      metricSelector: 'builtin:host.cpu.usage:max',
      resolution: 'Inf',
      ...RANGE
    })
  })

  it('sin resolución, no la fija (la elige la API)', async () => {
    const { client, dtRequest } = fakeClient()
    await createMetricsQuery(client, ENV_ID, RANGE)('builtin:host.cpu.usage')
    expect(dtRequest.mock.calls[0]?.[0].query.resolution).toBeUndefined()
  })

  it('lleva el entitySelector del rango si el canal lo pone', async () => {
    const { client, dtRequest } = fakeClient()
    const entitySelector = 'entityId("HOST-0123456789ABCDEF")'
    await createMetricsQuery(client, ENV_ID, { ...RANGE, entitySelector })('builtin:host.cpu.usage')
    expect(dtRequest.mock.calls[0]?.[0].query).toMatchObject({ entitySelector })
  })
})

describe('CA2 (0057): rethrowRejected', () => {
  it.each(['BAD_REQUEST', 'NOT_FOUND'] as const)(
    'reenvuelve %s con la clave dada, el estado y el texto de Dynatrace',
    (code) => {
      const original = new DtError(
        code,
        'Metric selector inválido',
        code === 'NOT_FOUND' ? 404 : 400
      )
      const error = thrown(() => rethrowRejected(original, 'hostMetricsRejected'))
      expect(error).toBeInstanceOf(DtError)
      const wrapped = error as DtError
      expect(wrapped.code).toBe(code)
      expect(wrapped.status).toBe(original.status)
      expect(wrapped.message).toBe('Metric selector inválido')
      expect(wrapped.reason).toEqual({
        key: 'hostMetricsRejected',
        params: { status: original.status, detail: 'Metric selector inválido' }
      })
    }
  )

  it('usa la clave que se le pasa (cada canal la suya)', () => {
    const error = thrown(() =>
      rethrowRejected(new DtError('BAD_REQUEST', 'x', 400), 'diskMetricsRejected')
    ) as DtError
    expect(error.reason?.key).toBe('diskMetricsRejected')
  })

  it('sin estado, el parámetro status va a 0', () => {
    const error = thrown(() =>
      rethrowRejected(new DtError('BAD_REQUEST', 'x'), 'processMetricsRejected')
    ) as DtError
    expect(error.reason?.params).toEqual({ status: 0, detail: 'x' })
  })

  it.each([
    ['DtError de otro código', new DtError('UNAUTHORIZED', 'Token inválido', 401)],
    ['DtError de red', new DtError('NETWORK', 'Sin conexión')],
    [
      'DomainError',
      new DomainError('NOT_FOUND', 'El entorno no existe.', { key: 'environmentMissing' })
    ],
    ['Error cualquiera', new Error('fallo')],
    ['valor que no es Error', 'texto']
  ])('deja pasar el resto tal cual: %s', (_name, original) => {
    expect(thrown(() => rethrowRejected(original, 'hostMetricsRejected'))).toBe(original)
  })
})
