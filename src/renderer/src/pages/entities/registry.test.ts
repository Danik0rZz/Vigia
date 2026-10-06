import { describe, expect, it } from 'vitest'
import en from '../../locales/en/common.json'
import es from '../../locales/es/common.json'
import { ENTITY_PAGES, GenericEntityPage, entityPageFor } from './registry'

/**
 * Ficha 0003: registro `tipo → página` de la página de análisis de una entidad.
 * Cada tipo estándar de la tabla tiene su página propia (en construcción) y su
 * nombre en es y en; cualquier otro tipo va a la página genérica.
 */

/** Los 9 tipos de la ficha con su nombre en la interfaz. */
const TYPES = [
  { type: 'HOST', es: 'Host', en: 'Host' },
  { type: 'SERVICE', es: 'Servicio', en: 'Service' },
  { type: 'PROCESS_GROUP_INSTANCE', es: 'Proceso', en: 'Process' },
  { type: 'PROCESS_GROUP', es: 'Process group', en: 'Process group' },
  { type: 'SYNTHETIC_TEST', es: 'Browser monitor', en: 'Browser monitor' },
  { type: 'HTTP_CHECK', es: 'HTTP monitor', en: 'HTTP monitor' },
  { type: 'APPLICATION', es: 'Aplicación web', en: 'Web application' },
  { type: 'CLOUD_APPLICATION', es: 'Cloud application', en: 'Cloud application' },
  { type: 'ENVIRONMENT', es: 'Entorno', en: 'Environment' }
] as const

/** Busca una clave con puntos (admite el prefijo `common:`) en el JSON anidado. */
function lookup(messages: unknown, key: string): unknown {
  return key
    .replace(/^common:/, '')
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages
    )
}

/** Rutas `a.b.c` de todas las hojas de texto cuyo valor es exactamente `value`. */
function keysWithValue(messages: unknown, value: string, prefix = ''): string[] {
  if (typeof messages === 'string') return messages === value ? [prefix] : []
  if (messages === null || typeof messages !== 'object') return []
  return Object.entries(messages as Record<string, unknown>).flatMap(([key, child]) =>
    keysWithValue(child, value, prefix === '' ? key : `${prefix}.${key}`)
  )
}

describe('CA3 (0003): una página propia por cada uno de los 9 tipos, con su nombre en es y en', () => {
  it.each(TYPES)('$type tiene entrada propia en el registro', ({ type }) => {
    const entry = ENTITY_PAGES[type]
    expect(entry, type).toBeDefined()
    expect(entry?.Page, type).toBeTypeOf('function')
    expect(entry?.Page, `${type} no es la genérica`).not.toBe(GenericEntityPage)
    expect(entityPageFor(type), type).toBe(entry?.Page)
  })

  it('las 9 páginas son distintas entre sí', () => {
    const pages = TYPES.map(({ type }) => ENTITY_PAGES[type]?.Page)
    expect(pages.every((page) => page !== undefined)).toBe(true)
    expect(new Set(pages).size).toBe(TYPES.length)
  })

  it.each(TYPES)('$type se llama «$es» en es y «$en» en en', ({ type, es: esName, en: enName }) => {
    const labelKey = ENTITY_PAGES[type]?.labelKey ?? ''
    expect(labelKey, `labelKey de ${type}`).not.toBe('')
    expect(lookup(es, labelKey), `es: ${labelKey}`).toBe(esName)
    expect(lookup(en, labelKey), `en: ${labelKey}`).toBe(enName)
  })
})

describe('CA4 (0003): un tipo que no está en el registro va a la página genérica', () => {
  it.each([
    'TIPO_ESTANDAR_INVENTADO',
    'algo:otro',
    // Claves que un objeto normal resolvería por su prototipo.
    'constructor',
    'toString',
    '__proto__',
    'hasOwnProperty'
  ])('%s → GenericEntityPage', (type) => {
    expect(entityPageFor(type)).toBe(GenericEntityPage)
  })
})

describe('CA10 (0003): los textos nuevos existen en es y en', () => {
  it.each(['Analizar entidad', 'Página en construcción'])(
    '«%s» está en es y su clave tiene texto propio en en',
    (spanish) => {
      const keys = keysWithValue(es, spanish)
      expect(keys, `ninguna clave de es dice «${spanish}»`).not.toEqual([])
      for (const key of keys) {
        const english = lookup(en, key)
        expect(english, `en: ${key}`).toBeTypeOf('string')
        expect((english as string).trim(), `en: ${key}`).not.toBe('')
        expect(english, `en: ${key} sin traducir`).not.toBe(spanish)
      }
    }
  )

  it('los nombres de los 9 tipos existen en es y en', () => {
    const missing = TYPES.flatMap(({ type }) => {
      const key = ENTITY_PAGES[type]?.labelKey ?? `<sin labelKey: ${type}>`
      return [
        ...(typeof lookup(es, key) === 'string' ? [] : [`es:${key}`]),
        ...(typeof lookup(en, key) === 'string' ? [] : [`en:${key}`])
      ]
    })
    expect(missing).toEqual([])
  })
})
