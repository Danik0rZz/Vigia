import { describe, expect, it } from 'vitest'
import glossaryMarkdown from '../../../../docs/glosario.md?raw'
import en from './en.json'
import es from './es.json'

/**
 * Textos de la interfaz: los dos idiomas tienen exactamente las mismas claves,
 * ninguna vacía, y los nombres propios de Dynatrace del glosario se escriben
 * igual en los dos.
 */

type Messages = { [key: string]: string | Messages }

/** Aplana el JSON anidado a `{ 'nav.home': 'Inicio', ... }`. */
function flatten(messages: unknown, prefix = ''): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(messages as Messages)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(flat, flatten(value, path))
    } else {
      flat[path] = value
    }
  }
  return flat
}

/** Términos de la tabla de `docs/glosario.md` (primera columna, sin la cabecera). */
function glossaryTerms(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.split('|')[1]?.trim() ?? '')
    .filter((term) => term !== '' && term !== 'Término' && !/^-+$/.test(term))
}

const flatEs = flatten(es)
const flatEn = flatten(en)

describe('locales es y en', () => {
  it('tienen exactamente el mismo conjunto de claves', () => {
    const esKeys = Object.keys(flatEs).sort()
    const enKeys = Object.keys(flatEn).sort()
    expect(
      esKeys.filter((key) => !(key in flatEn)),
      'claves solo en es'
    ).toEqual([])
    expect(
      enKeys.filter((key) => !(key in flatEs)),
      'claves solo en en'
    ).toEqual([])
    expect(esKeys.length).toBeGreaterThan(0)
  })

  it.each([
    ['es', flatEs],
    ['en', flatEn]
  ])('%s no tiene valores vacíos ni que no sean texto', (_locale, flat) => {
    const invalid = Object.entries(flat)
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([key]) => key)
    expect(invalid).toEqual([])
  })

  it('traducen el menú', () => {
    const menu = {
      home: ['Inicio', 'Home'],
      problems: ['Problemas', 'Problems'],
      topology: ['Topología', 'Topology'],
      metrics: ['Métricas', 'Metrics'],
      logs: ['Logs y DQL', 'Logs and DQL'],
      slos: ['SLOs', 'SLOs'],
      serviceFlows: ['Service flows', 'Service flows'],
      businessView: ['Vista de negocio', 'Business view'],
      configuration: ['Configuración', 'Configuration'],
      integrations: ['Integraciones', 'Integrations'],
      settings: ['Ajustes', 'Settings']
    }
    for (const [id, [textEs, textEn]] of Object.entries(menu)) {
      expect(flatEs[`nav.${id}`], `es nav.${id}`).toBe(textEs)
      expect(flatEn[`nav.${id}`], `en nav.${id}`).toBe(textEn)
    }
  })

  it('el glosario tiene los nombres propios esperados', () => {
    const terms = glossaryTerms(glossaryMarkdown)
    expect(terms).toEqual(
      expect.arrayContaining(['Davis', 'Grail', 'DQL', 'SLO', 'OneAgent', 'ActiveGate'])
    )
    expect(terms).toContain('management zone')
  })

  it('los nombres propios del glosario se escriben igual en es y en', () => {
    const terms = glossaryTerms(glossaryMarkdown)
    const mismatches: string[] = []
    for (const key of Object.keys(flatEs)) {
      const textEs = String(flatEs[key])
      const textEn = String(flatEn[key] ?? '')
      for (const term of terms) {
        if (textEs.includes(term) !== textEn.includes(term)) {
          mismatches.push(`${key}: "${term}" (es: "${textEs}", en: "${textEn}")`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })
})
