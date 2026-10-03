import { describe, expect, it } from 'vitest'
import en from '../locales/en/common.json'
import es from '../locales/es/common.json'
import { TIME_RANGES, useTimeRange } from './time-range'

/** Rango temporal global de la barra superior: lista única y estado sin persistir. */

/** Busca una clave con puntos (`timeRange.options.2h`) en el JSON anidado. */
function lookup(messages: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages
    )
}

describe('TIME_RANGES', () => {
  it('tiene 2h, 24h, 7d y personalizado, en ese orden', () => {
    expect(TIME_RANGES.map((range) => range.id)).toEqual(['2h', '24h', '7d', 'custom'])
  })

  it('cada rango usa la clave timeRange.options.<id>', () => {
    for (const range of TIME_RANGES) {
      expect(range.labelKey).toBe(`timeRange.options.${range.id}`)
    }
  })

  it.each([
    ['es', es, 'Rango temporal'],
    ['en', en, 'Time range']
  ])('los textos existen en %s', (_locale, messages, label) => {
    expect(lookup(messages, 'timeRange.label')).toBe(label)
    const labels = TIME_RANGES.map((range) => lookup(messages, range.labelKey))
    expect(labels.slice(0, 3)).toEqual(['2 h', '24 h', '7 d'])
    expect(typeof labels[3] === 'string' && labels[3].trim() !== '', 'texto de personalizado').toBe(
      true
    )
  })
})

describe('useTimeRange', () => {
  it('empieza en 2h y cambia al seleccionar otro rango', () => {
    expect(useTimeRange.getState().selected).toBe('2h')
    useTimeRange.getState().select('7d')
    expect(useTimeRange.getState().selected).toBe('7d')
    useTimeRange.getState().select('2h')
  })

  it('no usa persist de Zustand: el rango no se guarda entre sesiones', () => {
    expect('persist' in useTimeRange).toBe(false)
  })
})
