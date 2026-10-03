import { describe, expect, it } from 'vitest'
import glossaryMarkdown from '../../../../docs/glosario.md?raw'

/**
 * Textos de la interfaz, en `locales/<idioma>/<namespace>.json`: los dos
 * idiomas tienen los mismos namespaces y, en cada uno, exactamente las mismas
 * claves, ninguna vacía. Los nombres propios de Dynatrace del glosario se
 * escriben igual en los dos.
 */

type Locale = 'es' | 'en'
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

/** `{ es: { common: {...}, ... }, en: {...} }`, ya aplanados, a partir de los ficheros. */
const files = import.meta.glob('./*/*.json', { eager: true, import: 'default' })
const locales: Record<string, Record<string, Record<string, unknown>>> = {}
for (const [path, messages] of Object.entries(files)) {
  const match = /^\.\/([^/]+)\/([^/]+)\.json$/.exec(path)
  if (match === null) continue
  const [, locale = '', namespace = ''] = match
  locales[locale] ??= {}
  locales[locale][namespace] = flatten(messages)
}

const es = locales['es'] ?? {}
const en = locales['en'] ?? {}
const namespaces = Object.keys(es).sort()

/** Texto de `namespace:clave` en un idioma. */
function text(locale: Locale, namespace: string, key: string): unknown {
  return (locale === 'es' ? es : en)[namespace]?.[key]
}

describe('locales es y en', () => {
  it('solo hay carpetas es y en', () => {
    expect(Object.keys(locales).sort()).toEqual(['en', 'es'])
  })

  it('existe el namespace common', () => {
    expect(namespaces).toContain('common')
  })

  it('los dos idiomas tienen el mismo conjunto de namespaces', () => {
    expect(Object.keys(en).sort()).toEqual(namespaces)
  })

  it.each(namespaces)('el namespace %s tiene exactamente las mismas claves en es y en', (ns) => {
    const esKeys = Object.keys(es[ns] ?? {})
    const enKeys = Object.keys(en[ns] ?? {})
    expect(
      esKeys.filter((key) => !enKeys.includes(key)),
      `claves de ${ns} solo en es`
    ).toEqual([])
    expect(
      enKeys.filter((key) => !esKeys.includes(key)),
      `claves de ${ns} solo en en`
    ).toEqual([])
    expect(esKeys.length, `${ns} no está vacío`).toBeGreaterThan(0)
  })

  it('ningún valor está vacío ni deja de ser texto', () => {
    const invalid: string[] = []
    for (const [locale, byNamespace] of Object.entries(locales)) {
      for (const [ns, flat] of Object.entries(byNamespace)) {
        for (const [key, value] of Object.entries(flat)) {
          if (typeof value !== 'string' || value.trim() === '') {
            invalid.push(`${locale}/${ns}:${key}`)
          }
        }
      }
    }
    expect(invalid).toEqual([])
  })

  it('traducen el menú (common)', () => {
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
      expect(text('es', 'common', `nav.${id}`), `es nav.${id}`).toBe(textEs)
      expect(text('en', 'common', `nav.${id}`), `en nav.${id}`).toBe(textEn)
    }
  })

  it('traducen los mecanismos de conexión de la tarjeta de estado (common)', () => {
    const mechanisms = {
      classic: ['Token clásico', 'Classic token'],
      oauth: ['OAuth', 'OAuth'],
      platform: ['Platform token', 'Platform token']
    }
    for (const [id, [textEs, textEn]] of Object.entries(mechanisms)) {
      const key = `envStatus.mechanisms.${id}`
      expect(text('es', 'common', key), `es ${key}`).toBe(textEs)
      expect(text('en', 'common', key), `en ${key}`).toBe(textEn)
    }
    // La sesión capturada es de la Fase 10: no puede haber textos suyos todavía.
    const mechanismKeys = Object.keys(es['common'] ?? {}).filter((key) =>
      key.startsWith('envStatus.mechanisms.')
    )
    expect(mechanismKeys.sort()).toEqual([
      'envStatus.mechanisms.classic',
      'envStatus.mechanisms.oauth',
      'envStatus.mechanisms.platform'
    ])
  })

  it('hay un texto de error para cada código del cliente de Dynatrace (common)', () => {
    // Copia de DtErrorCode (src/main/dynatrace/errors.ts); el renderer no puede importar main.
    const codes = [
      'NO_CREDENTIAL',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'RATE_LIMITED',
      'TIMEOUT',
      'NETWORK',
      'TLS_UNTRUSTED',
      'TLS_PIN_MISMATCH',
      'INVALID_RESPONSE',
      'SERVER_ERROR'
    ]
    const dtErrorKeys = Object.keys(es['common'] ?? {})
      .filter((key) => key.startsWith('dtErrors.'))
      .map((key) => key.slice('dtErrors.'.length))
    expect(dtErrorKeys.sort()).toEqual([...codes].sort())
  })

  it('traducen la prueba de conexión y los certificados (common)', () => {
    const texts = {
      'connection.test': ['Probar conexión', 'Test connection'],
      'connection.connected': ['Conectado', 'Connected'],
      'connection.disconnected': ['Sin conexión', 'Disconnected'],
      'errors.apiSuffix': [
        'Escribe la URL del entorno sin /api/v2',
        'Enter the environment URL without /api/v2'
      ]
    }
    for (const [key, [textEs, textEn]] of Object.entries(texts)) {
      expect(text('es', 'common', key), `es ${key}`).toBe(textEs)
      expect(text('en', 'common', key), `en ${key}`).toBe(textEn)
    }
    for (const key of [
      'certificates.previous',
      'certificates.current',
      'certificates.accept',
      'certificates.ignoreWarning'
    ]) {
      expect(text('es', 'common', key), `es ${key}`).toBeTypeOf('string')
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
    for (const ns of namespaces) {
      for (const key of Object.keys(es[ns] ?? {})) {
        const textEs = String(text('es', ns, key))
        const textEn = String(text('en', ns, key) ?? '')
        for (const term of terms) {
          if (textEs.includes(term) !== textEn.includes(term)) {
            mismatches.push(`${ns}:${key}: "${term}" (es: "${textEs}", en: "${textEn}")`)
          }
        }
      }
    }
    expect(mismatches).toEqual([])
  })
})
