import { describe, expect, it } from 'vitest'
import en from '../locales/en/common.json'
import es from '../locales/es/common.json'
import { NAV_SECTIONS } from './navigation'

/**
 * Lista única de secciones: de ella salen el menú, las rutas hash y la paleta
 * Ctrl+K, así que aquí se fija su forma exacta.
 */

/** Ids, rutas y grupos acordados para la Fase 2, en orden. */
const EXPECTED = [
  { id: 'home', path: '/', group: 'monitoring' },
  { id: 'problems', path: '/problems', group: 'monitoring' },
  { id: 'topology', path: '/topology', group: 'monitoring' },
  { id: 'metrics', path: '/metrics', group: 'monitoring' },
  { id: 'logs', path: '/logs', group: 'monitoring' },
  { id: 'slos', path: '/slos', group: 'monitoring' },
  { id: 'serviceFlows', path: '/service-flows', group: 'analysis' },
  { id: 'businessView', path: '/business', group: 'analysis' },
  { id: 'configuration', path: '/configuration', group: 'administration' },
  { id: 'integrations', path: '/integrations', group: 'administration' },
  { id: 'settings', path: '/settings', group: null }
] as const

/** Busca una clave con puntos (`nav.groups.monitoring`) en el JSON anidado. */
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

describe('NAV_SECTIONS', () => {
  it('tiene exactamente las 11 secciones acordadas, en orden, con su ruta y su grupo', () => {
    expect(NAV_SECTIONS.map(({ id, path, group }) => ({ id, path, group }))).toEqual(EXPECTED)
  })

  it('no repite ids ni rutas', () => {
    const ids = NAV_SECTIONS.map((section) => section.id)
    const paths = NAV_SECTIONS.map((section) => section.path)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('las rutas empiezan por "/" y sirven como hash (#/...)', () => {
    for (const section of NAV_SECTIONS) {
      expect(section.path).toMatch(/^\/[a-z-]*$/)
    }
  })

  it('cada sección usa la clave nav.<id> y tiene icono', () => {
    for (const section of NAV_SECTIONS) {
      expect(section.labelKey).toBe(`nav.${section.id}`)
      expect(section.icon, `icono de ${section.id}`).toBeTruthy()
    }
  })

  it('Configuración está en el grupo Administración y Ajustes fuera de los grupos', () => {
    expect(NAV_SECTIONS.find((section) => section.id === 'configuration')?.group).toBe(
      'administration'
    )
    expect(NAV_SECTIONS.find((section) => section.id === 'settings')?.group).toBeNull()
  })

  it.each([
    ['es', es],
    ['en', en]
  ])('todas las claves de sección y de grupo existen en %s', (_locale, messages) => {
    const groups = new Set(
      NAV_SECTIONS.flatMap((section) => (section.group === null ? [] : [section.group]))
    )
    const keys = [
      ...NAV_SECTIONS.map((section) => section.labelKey),
      ...[...groups].map((group) => `nav.groups.${group}`),
      'nav.aria'
    ]
    const missing = keys.filter((key) => {
      const value = lookup(messages, key)
      return typeof value !== 'string' || value.trim() === ''
    })
    expect(missing).toEqual([])
  })
})
