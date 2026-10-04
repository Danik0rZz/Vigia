import { describe, expect, it } from 'vitest'
import { metricsLink, parseMetricsSearch } from './metrics-link'

/**
 * v0.9.1: "Abrir en Métricas" desde una evidencia. El enlace lleva la métrica
 * y el rango del problema con 30 min de margen (sin pasar de ahora), y
 * Métricas solo acepta lo que valida: selector no vacío y rango personalizado
 * correcto. Sin filtro por entidad.
 */

const MIN = 60_000
const NOW = Date.UTC(2026, 9, 4, 12, 0)
const START = Date.UTC(2026, 9, 4, 9, 0)

/** Parámetros de un enlace generado. */
function paramsOf(link: string): URLSearchParams {
  const [path, query] = link.split('?')
  expect(path).toBe('/metrics')
  return new URLSearchParams(query)
}

describe('metricsLink', () => {
  it('problema cerrado: desde inicio − 30 min hasta fin + 30 min', () => {
    const end = START + 60 * MIN
    const params = paramsOf(
      metricsLink('builtin:service.response.time', { startTime: START, endTime: end }, NOW)
    )
    expect(params.get('selector')).toBe('builtin:service.response.time')
    expect(params.get('from')).toBe(new Date(START - 30 * MIN).toISOString())
    expect(params.get('to')).toBe(new Date(end + 30 * MIN).toISOString())
    expect([...params.keys()].sort()).toEqual(['from', 'selector', 'to'])
  })

  it('problema abierto (endTime null): hasta ahora', () => {
    const params = paramsOf(metricsLink('m', { startTime: START, endTime: null }, NOW))
    expect(params.get('to')).toBe(new Date(NOW).toISOString())
  })

  it('fin + 30 min no pasa de ahora', () => {
    const params = paramsOf(metricsLink('m', { startTime: START, endTime: NOW - 10 * MIN }, NOW))
    expect(params.get('to')).toBe(new Date(NOW).toISOString())
  })

  it('sin filtro por entidad: no añade entitySelector ni dimensiones', () => {
    const link = metricsLink('builtin:host.cpu.usage', { startTime: START, endTime: null }, NOW)
    expect(link).not.toMatch(/entity|dt\.entity|filter/i)
  })

  it('un metricId con caracteres especiales va codificado y vuelve igual', () => {
    const metricId = 'builtin:service.response.time:filter(eq("dt.entity.service","S&1"))#x'
    const link = metricsLink(metricId, { startTime: START, endTime: null }, NOW)
    expect(link).not.toContain('#')
    expect(link.split('&')).toHaveLength(3)
    expect(parseMetricsSearch(paramsOf(link))?.selector).toBe(metricId)
  })

  it('problema abierto hace más de un año: from = to − 1 año exacto, y Métricas lo acepta', () => {
    const YEAR = 365 * 24 * 60 * MIN
    const link = metricsLink('m', { startTime: NOW - 2 * YEAR, endTime: null }, NOW)
    const params = paramsOf(link)
    expect(params.get('to')).toBe(new Date(NOW).toISOString())
    expect(params.get('from')).toBe(new Date(NOW - YEAR).toISOString())
    expect(parseMetricsSearch(params)).not.toBeNull()
  })

  it('inicio en el futuro (desfase de reloj, from ≥ to): la última hora, y Métricas lo acepta', () => {
    const link = metricsLink('m', { startTime: NOW + 2 * 60 * MIN, endTime: null }, NOW)
    const params = paramsOf(link)
    expect(params.get('to')).toBe(new Date(NOW).toISOString())
    expect(params.get('from')).toBe(new Date(NOW - 60 * MIN).toISOString())
    expect(parseMetricsSearch(params)).not.toBeNull()
  })

  it('inicio justo 30 min en el futuro (from = to exacto) también cae en la última hora', () => {
    const params = paramsOf(metricsLink('m', { startTime: NOW + 30 * MIN, endTime: null }, NOW))
    expect(params.get('from')).toBe(new Date(NOW - 60 * MIN).toISOString())
  })

  it('ida y vuelta: lo que genera metricsLink lo acepta parseMetricsSearch', () => {
    const link = metricsLink('m', { startTime: START, endTime: START + 5 * MIN }, NOW)
    expect(parseMetricsSearch(paramsOf(link))).toEqual({
      selector: 'm',
      range: {
        from: new Date(START - 30 * MIN).toISOString(),
        to: new Date(START + 35 * MIN).toISOString()
      }
    })
  })
})

describe('parseMetricsSearch', () => {
  const FROM = '2026-10-04T08:30:00.000Z'
  const TO = '2026-10-04T10:30:00.000Z'
  const parse = (query: Record<string, string>): ReturnType<typeof parseMetricsSearch> =>
    parseMetricsSearch(new URLSearchParams(query))

  it('válido: selector (sin espacios a los lados) y rango personalizado', () => {
    expect(parse({ selector: '  builtin:host.cpu.usage  ', from: FROM, to: TO })).toEqual({
      selector: 'builtin:host.cpu.usage',
      range: { from: FROM, to: TO }
    })
  })

  it('acepta fechas ISO con offset', () => {
    expect(
      parse({ selector: 'm', from: '2026-10-04T10:30:00+02:00', to: '2026-10-04T12:30:00+02:00' })
    ).not.toBeNull()
  })

  it.each([
    ['sin nada', {}],
    ['sin selector', { from: FROM, to: TO }],
    ['selector vacío', { selector: '', from: FROM, to: TO }],
    ['selector solo espacios', { selector: '   ', from: FROM, to: TO }],
    ['selector de más de 2000', { selector: 'm'.repeat(2001), from: FROM, to: TO }],
    ['sin from', { selector: 'm', to: TO }],
    ['sin to', { selector: 'm', from: FROM }],
    ['from basura', { selector: 'm', from: 'ayer', to: TO }],
    ['to basura', { selector: 'm', from: FROM, to: '<script>' }],
    ['fecha sin offset', { selector: 'm', from: '2026-10-04T08:30:00', to: TO }],
    ['número en vez de ISO', { selector: 'm', from: '1791050000000', to: TO }],
    ['rango al revés', { selector: 'm', from: TO, to: FROM }],
    ['from igual a to', { selector: 'm', from: FROM, to: FROM }],
    [
      'más de un año',
      { selector: 'm', from: '2025-10-03T08:00:00.000Z', to: '2026-10-04T08:00:00.000Z' }
    ],
    ['un preset en vez de fechas', { selector: 'm', from: '2h', to: '2h' }]
  ])('%s → null', (_label, query) => {
    expect(parse(query as Record<string, string>)).toBeNull()
  })

  it('selector de exactamente 2000 sí vale; un año justo también', () => {
    expect(parse({ selector: 'm'.repeat(2000), from: FROM, to: TO })).not.toBeNull()
    expect(
      parse({ selector: 'm', from: '2025-10-04T08:00:00.000Z', to: '2026-10-04T08:00:00.000Z' })
    ).not.toBeNull()
  })

  it('ignora parámetros de más (saved, entity…)', () => {
    expect(parse({ selector: 'm', from: FROM, to: TO, saved: 'x', entity: 'HOST-1' })).toEqual({
      selector: 'm',
      range: { from: FROM, to: TO }
    })
  })
})
