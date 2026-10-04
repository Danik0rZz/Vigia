import { beforeAll, describe, expect, it } from 'vitest'

/**
 * v0.10.2: eje de tiempo de los gráficos. Antes, el mini gráfico recortaba la
 * fecha a HH:mm y en rangos de días todas las etiquetas salían «00:00». Ahora
 * el formato va por niveles de ECharts y por la resolución DEVUELTA: con
 * resolución diaria (o mayor), solo la fecha. En hora local (Europe/Madrid en
 * estas pruebas, con el cambio de hora del último domingo de octubre).
 */

process.env.TZ = 'Europe/Madrid'

type Module = typeof import('./chart-time')
let m: Module
beforeAll(async () => {
  m = await import('./chart-time')
})

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Medianoche local (Madrid, horario de verano: UTC+2) del 1 de octubre de 2026. */
const OCT1 = Date.UTC(2026, 8, 30, 22, 0)

type Unit = Parameters<Module['formatTimeTick']>[1]

/**
 * Marcas como las pondría ECharts: en el cambio de día, el nivel 'day'; en el
 * resto, el de la unidad del paso.
 */
function ticks(
  from: number,
  to: number,
  step: number,
  unit: Unit
): { value: number; unit: Unit }[] {
  const out: { value: number; unit: Unit }[] = []
  for (let value = from; value <= to; value += step) {
    const local = new Date(value)
    const midnight = local.getHours() === 0 && local.getMinutes() === 0
    out.push({ value, unit: midnight && unit !== 'day' ? 'day' : unit })
  }
  return out
}

const labels = (
  marks: { value: number; unit: Unit }[],
  lang: string,
  resolution: string | null
): string[] => marks.map((mark) => m.formatTimeTick(mark.value, mark.unit, lang, resolution))

describe('resolutionMs', () => {
  it.each([
    ['1m', 60_000],
    ['5m', 300_000],
    ['1h', HOUR],
    ['6h', 6 * HOUR],
    ['1d', DAY],
    ['1w', 7 * DAY]
  ])('%s → %s', (resolution, ms) => {
    expect(m.resolutionMs(resolution)).toBe(ms)
  })

  it.each(['', 'Inf', 'abc', '10', 'h1'])('%j → null', (resolution) => {
    expect(m.resolutionMs(resolution)).toBeNull()
  })
})

describe('formatTimeTick por nivel', () => {
  const value = OCT1 + 14 * HOUR + 35 * 60_000 + 7_000 // 01/10/2026 14:35:07 local

  it.each([
    ['es', 'year', '2026'],
    ['es', 'month', '01/10'],
    ['es', 'day', '01/10'],
    ['en', 'day', '10-01'],
    ['es', 'hour', '14:35'],
    ['es', 'minute', '14:35'],
    ['es', 'second', '14:35:07']
  ] as const)('resolución fina (1m), %s, nivel %s → %s', (lang, unit, expected) => {
    expect(m.formatTimeTick(value, unit, lang, '1m')).toBe(expected)
  })

  it('sin resolución (aún no ha llegado) se comporta como una fina', () => {
    expect(m.formatTimeTick(value, 'hour', 'es', null)).toBe('14:35')
    expect(m.formatTimeTick(value, 'day', 'es', null)).toBe('01/10')
  })

  it.each(['1d', '1w', '7d'])(
    'resolución %s (≥ 1 día): solo la fecha en todos los niveles por debajo del mes, nunca hora',
    (resolution) => {
      for (const unit of ['day', 'hour', 'minute', 'second', 'millisecond'] as const) {
        const text = m.formatTimeTick(value, unit, 'es', resolution)
        expect(text, unit).toBe('01/10')
        expect(text, unit).not.toContain(':')
      }
      expect(m.formatTimeTick(value, 'year', 'es', resolution)).toBe('2026')
    }
  )
})

describe('rangos típicos (regresión del «00:00»)', () => {
  it('2 h con 1m: horas variadas, sin fecha', () => {
    const marks = ticks(OCT1 + 10 * HOUR, OCT1 + 12 * HOUR, 15 * 60_000, 'minute')
    const out = labels(marks, 'es', '1m')
    expect(new Set(out).size).toBe(out.length)
    expect(out.every((text) => /^\d\d:\d\d$/.test(text))).toBe(true)
  })

  it.each(['es', 'en'])(
    '26 h con 1h (%s): horas variadas y la fecha en el cambio de día',
    (lang) => {
      const marks = ticks(OCT1 + 12 * HOUR, OCT1 + 38 * HOUR, 6 * HOUR, 'hour')
      const out = labels(marks, lang, '1h')
      expect(new Set(out).size).toBeGreaterThan(1)
      expect(out).toContain(lang === 'es' ? '02/10' : '10-02')
      expect(out).toContain('18:00')
      // Nunca todas iguales, y nunca todas «00:00».
      expect(out.filter((text) => text === '00:00')).toHaveLength(0)
    }
  )

  it('3 d con 1h: cada medianoche muestra su fecha', () => {
    const marks = ticks(OCT1, OCT1 + 3 * DAY, 12 * HOUR, 'hour')
    const out = labels(marks, 'es', '1h')
    expect(out).toEqual(['01/10', '12:00', '02/10', '12:00', '03/10', '12:00', '04/10'])
  })

  it.each(['es', 'en'])('7 d con 1h (%s): fechas distintas en las marcas de día', (lang) => {
    const marks = ticks(OCT1, OCT1 + 7 * DAY, DAY, 'hour')
    const out = labels(marks, lang, '1h')
    expect(new Set(out).size).toBe(8)
  })

  it('45 d con resolución diaria: solo fechas, todas distintas, sin «00:00»', () => {
    // Como ECharts: la medianoche LOCAL de cada día (cruza el fin del horario de verano el
    // 25/10; con pasos fijos de 24 h, una fecha saldría dos veces).
    const marks = Array.from({ length: 45 }, (_, i) => ({
      value: new Date(2026, 9, 1 + i).getTime(),
      unit: 'day' as Unit
    }))
    const out = labels(marks, 'es', '1d')
    expect(new Set(out).size).toBe(45)
    expect(out).toContain('25/10')
    expect(out).toContain('26/10')
    expect(out.some((text) => text.includes(':'))).toBe(false)
    expect(out[0]).toBe('01/10')
  })

  it('45 d pedido fino pero la API devuelve 1d: manda la devuelta (solo fechas)', () => {
    // Las marcas de un eje de días con hora: con 1d no se pinta la hora.
    const marks = ticks(OCT1 + 12 * HOUR, OCT1 + 12 * HOUR + 10 * DAY, DAY, 'hour')
    expect(labels(marks, 'es', '1d').some((text) => text.includes(':'))).toBe(false)
    expect(new Set(labels(marks, 'es', '1d')).size).toBe(11)
  })
})

describe('cambio de hora (último domingo de octubre, Europe/Madrid)', () => {
  // 25/10/2026: a las 03:00 CEST se vuelve a las 02:00 CET.
  const beforeChange = Date.UTC(2026, 9, 25, 0, 0) // 02:00 CEST
  const repeated = Date.UTC(2026, 9, 25, 1, 0) // 02:00 CET (la hora se repite)
  const after = Date.UTC(2026, 9, 25, 2, 0) // 03:00 CET
  const midnight = Date.UTC(2026, 9, 24, 22, 0) // 25/10 00:00 CEST

  it('las horas son las locales, también la repetida', () => {
    expect(m.formatTimeTick(beforeChange, 'hour', 'es', '1h')).toBe('02:00')
    expect(m.formatTimeTick(repeated, 'hour', 'es', '1h')).toBe('02:00')
    expect(m.formatTimeTick(after, 'hour', 'es', '1h')).toBe('03:00')
  })

  it('la medianoche del día del cambio sale con su fecha (25/10), no con la del 24', () => {
    expect(m.formatTimeTick(midnight, 'day', 'es', '1h')).toBe('25/10')
    expect(m.formatTimeTick(midnight, 'day', 'en', '1d')).toBe('10-25')
  })

  it('un eje de 3 días que cruza el cambio sigue dando una fecha por día', () => {
    const marks = [
      { value: Date.UTC(2026, 9, 23, 22, 0), unit: 'day' as Unit }, // 24/10 00:00 CEST
      { value: midnight, unit: 'day' as Unit }, // 25/10 00:00 CEST
      { value: Date.UTC(2026, 9, 25, 23, 0), unit: 'day' as Unit } // 26/10 00:00 CET
    ]
    expect(labels(marks, 'es', '1d')).toEqual(['24/10', '25/10', '26/10'])
  })
})

describe('timeAxisLabel', () => {
  it('hideOverlap y un formatter por niveles (no una función)', () => {
    const label = m.timeAxisLabel('es', '1h') as {
      hideOverlap?: boolean
      formatter?: unknown
    }
    expect(label.hideOverlap).toBe(true)
    expect(typeof label.formatter).toBe('object')
  })

  it('con 1d, ninguna plantilla lleva la hora; con 1h, sí', () => {
    const daily = JSON.stringify(m.timeAxisLabel('es', '1d'))
    expect(daily).not.toContain('{HH}')
    expect(daily).toContain('{dd}/{MM}')
    const hourly = JSON.stringify(m.timeAxisLabel('en', '1h'))
    expect(hourly).toContain('{HH}:{mm}')
    expect(hourly).toContain('{MM}-{dd}')
  })
})

describe('tooltipTime', () => {
  it('fecha y hora completas en el formato del idioma', () => {
    const value = OCT1 + 14 * HOUR + 35 * 60_000
    expect(m.tooltipTime(value, 'es')).toBe('01/10/2026 14:35')
    expect(m.tooltipTime(value, 'en')).toBe('2026-10-01 14:35')
  })
})
