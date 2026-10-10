import i18next, { type TFunction } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import en from '../../locales/en/common.json'
import es from '../../locales/es/common.json'
import { SERVICE_TYPE_NAMES, serviceMetricNote, serviceTypeName } from './service-type'

/**
 * Ficha 0047: nombre legible del `serviceType` en la cabecera de la página del servicio y nota
 * bajo los marcadores según el conjunto de métricas de la 0046.
 *
 * Lo que fijan estos tests (la ficha no lo daba): `serviceTypeName(tipo, t)` da el nombre de los
 * tipos de la tabla de la 0046 y el código tal cual para los demás; `serviceMetricNote` sale de
 * los campos estructurados `serviceType` y `metricSet` (no del texto de `warnings`): Servidor con
 * un tipo de la tabla no lleva nota, y Servidor sin tipo o con uno fuera de la tabla es el
 * «por defecto» (`fallback`).
 */

const TABLE_TYPES = [
  'WEB_SERVICE',
  'CUSTOM_SERVICE',
  'BACKGROUND_ACTIVITY',
  'SPAN',
  'MESSAGING_SERVICE',
  'EXTERNAL',
  'WEB_REQUEST_SERVICE',
  'RPC_SERVICE',
  'DATABASE_SERVICE',
  'UNIFIED',
  'QUEUE_LISTENER_SERVICE'
]

const translators: Record<'es' | 'en', TFunction> = {} as Record<'es' | 'en', TFunction>
beforeAll(async () => {
  for (const [lng, messages] of [
    ['es', es],
    ['en', en]
  ] as const) {
    const instance = i18next.createInstance()
    await instance.init({
      lng,
      resources: { [lng]: { common: messages } },
      defaultNS: 'common',
      interpolation: { escapeValue: false }
    })
    translators[lng] = instance.getFixedT(lng)
  }
})

describe('CA5 (0047): nombres legibles de los tipos de servicio en es y en', () => {
  it('la lista de nombres cubre exactamente los tipos de la tabla de la 0046', () => {
    expect([...SERVICE_TYPE_NAMES].sort()).toEqual([...TABLE_TYPES].sort())
  })

  it('los de la ficha, en español y en inglés', () => {
    expect(serviceTypeName('DATABASE_SERVICE', translators.es)).toBe('Base de datos')
    expect(serviceTypeName('DATABASE_SERVICE', translators.en)).toBe('Database')
    expect(serviceTypeName('WEB_SERVICE', translators.es)).toBe('Servicio web')
    expect(serviceTypeName('WEB_SERVICE', translators.en)).toBe('Web service')
    expect(serviceTypeName('QUEUE_LISTENER_SERVICE', translators.es)).toBe('Escucha de colas')
    expect(serviceTypeName('QUEUE_LISTENER_SERVICE', translators.en)).toBe('Queue listener')
    expect(serviceTypeName('UNIFIED', translators.es)).toBe('Unificado')
    expect(serviceTypeName('UNIFIED', translators.en)).toBe('Unified')
  })

  it('cada tipo de la tabla tiene nombre propio en los dos idiomas (ni la clave ni el código)', () => {
    for (const type of TABLE_TYPES) {
      for (const lng of ['es', 'en'] as const) {
        const name = serviceTypeName(type, translators[lng])
        expect(name, `${type} (${lng})`).not.toBe('')
        expect(name, `${type} (${lng})`).not.toBe(type)
        expect(name, `${type} (${lng})`).not.toContain('entities.')
      }
    }
  })

  it('un tipo desconocido sale tal cual, en los dos idiomas', () => {
    for (const lng of ['es', 'en'] as const) {
      expect(serviceTypeName('TIPO_INVENTADO_E2E', translators[lng])).toBe('TIPO_INVENTADO_E2E')
      // Los valores distinguen mayúsculas, como en la 0046.
      expect(serviceTypeName('database_service', translators[lng])).toBe('database_service')
    }
  })
})

describe('CA1 y CA2 (0047): la nota bajo los marcadores sale de serviceType y metricSet', () => {
  it('una nota por conjunto, sin nota en Servidor con un tipo de la tabla', () => {
    expect(
      serviceMetricNote({ serviceType: 'QUEUE_LISTENER_SERVICE', metricSet: 'activity' })
    ).toBe('activity')
    expect(serviceMetricNote({ serviceType: 'DATABASE_SERVICE', metricSet: 'client' })).toBe(
      'client'
    )
    expect(serviceMetricNote({ serviceType: 'UNIFIED', metricSet: 'unified' })).toBe('unified')
    expect(serviceMetricNote({ serviceType: 'WEB_SERVICE', metricSet: 'server' })).toBeNull()
  })

  it('Servidor sin serviceType (entidad sin entities.read) o con uno fuera de la tabla: por defecto', () => {
    expect(serviceMetricNote({ serviceType: null, metricSet: 'server' })).toBe('fallback')
    expect(serviceMetricNote({ serviceType: 'TIPO_INVENTADO_E2E', metricSet: 'server' })).toBe(
      'fallback'
    )
  })
})
