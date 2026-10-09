import { describe, expect, it } from 'vitest'
import { MAX_DESCRIPTION_LENGTH, evidenceWireSchema } from '@shared/problem-evidence'
import { problemDetailSchema, toProblemDetail } from './problems'

/**
 * Ficha 0035: main saca `dt.event.description` a `description` en CUALQUIER tipo de evidencia
 * que la traiga, no solo en EVENT, y la clave deja de salir en las propiedades genéricas.
 *
 * La OpenAPI v2 solo documenta `data` (el Event, con `properties[]`) en `EventEvidence`; en vivo
 * la clave solo se ha visto en `data.properties[]` (ficha 0001). Por eso la evidencia de otro
 * tipo la trae en el mismo sitio (decisión anotada en la ficha). Fixtures inventados, solo tipos
 * estándar de Dynatrace.
 */

const DESCRIPTION_KEY = 'dt.event.description'

const MARKDOWN = [
  '## Cambio en la métrica',
  '',
  '- **subida** brusca',
  '- revisar `pool`',
  '',
  '```yaml',
  'umbral: 90',
  '```'
].join('\n')

/** Problema sintético mínimo con una sola evidencia. */
function problemWith(evidence: Record<string, unknown>): Record<string, unknown> {
  return {
    problemId: 'p-0035',
    displayId: 'P-35',
    title: 'Respuesta lenta',
    status: 'OPEN',
    severityLevel: 'PERFORMANCE',
    impactLevel: 'SERVICES',
    startTime: 1791050000000,
    endTime: -1,
    affectedEntities: [],
    impactedEntities: [],
    managementZones: [],
    problemFilters: [],
    evidenceDetails: { details: [evidence] }
  }
}

const SERVICE = { entityId: { id: 'SERVICE-0035', type: 'SERVICE' }, name: 'svc-prueba' }

/** Campos propios de cada tipo (OpenAPI v2: MetricEvidence, TransactionalEvidence…). */
const BY_TYPE: Record<string, Record<string, unknown>> = {
  METRIC: {
    metricId: 'builtin:service.response.time',
    unit: 'MicroSecond',
    valueBeforeChangePoint: 100_000,
    valueAfterChangePoint: 300_000
  },
  TRANSACTIONAL: { unit: 'Percent', valueBeforeChangePoint: 0, valueAfterChangePoint: 12.5 },
  AVAILABILITY_EVIDENCE: {},
  MAINTENANCE_WINDOW: { maintenanceWindowConfigId: 'mw-0035' }
}

/** Evidencia de ese tipo con esas propiedades en `data.properties`. */
function evidenceOf(type: string, properties: unknown[] | null): Record<string, unknown> {
  return {
    evidenceType: type,
    displayName: `Evidencia ${type}`,
    entity: SERVICE,
    rootCauseRelevant: false,
    startTime: 1791050000000,
    endTime: 1791050600000,
    ...BY_TYPE[type],
    ...(properties === null ? {} : { data: { properties } })
  }
}

function normalize(evidence: Record<string, unknown>): Record<string, unknown> {
  const detail = toProblemDetail(problemDetailSchema.parse(problemWith(evidence)))
  const result = detail.evidence[0] as unknown as Record<string, unknown> | undefined
  expect(result).toBeDefined()
  return result as Record<string, unknown>
}

const propertyKeys = (wire: Record<string, unknown>): string[] =>
  ((wire['properties'] as { key: string }[] | undefined) ?? []).map((property) => property.key)

const NON_EVENT_TYPES = ['METRIC', 'TRANSACTIONAL', 'AVAILABILITY_EVIDENCE', 'MAINTENANCE_WINDOW']

describe('CA3 (0035): una evidencia que no es EVENT con dt.event.description la trae en description', () => {
  it.each(NON_EVENT_TYPES)('%s: la descripción llega entera en description', (type) => {
    const wire = normalize(
      evidenceOf(type, [
        { key: 'paso.0', value: 'valor-0' },
        { key: DESCRIPTION_KEY, value: MARKDOWN },
        { key: 'paso.1', value: 'valor-1' }
      ])
    )
    expect(wire['evidenceType']).toBe(type)
    expect(wire['description']).toEqual({ text: MARKDOWN, truncated: false })
    expect(evidenceWireSchema.safeParse(wire).success).toBe(true)
  })

  it.each(NON_EVENT_TYPES)('%s: la clave sale de las propiedades genéricas', (type) => {
    const wire = normalize(evidenceOf(type, [{ key: DESCRIPTION_KEY, value: MARKDOWN }]))
    expect(propertyKeys(wire)).not.toContain(DESCRIPTION_KEY)
    // Ni el texto de la descripción se cuela en ninguna propiedad genérica.
    const texts = ((wire['properties'] as { text: string }[] | undefined) ?? []).map((p) => p.text)
    expect(texts.some((text) => text.includes('Cambio en la métrica'))).toBe(false)
  })

  it('un tipo desconocido con la clave también la trae en description', () => {
    const wire = normalize(
      evidenceOf('TIPO_NUEVO_0035', [{ key: DESCRIPTION_KEY, value: MARKDOWN }])
    )
    expect(wire['description']).toEqual({ text: MARKDOWN, truncated: false })
    expect(propertyKeys(wire)).not.toContain(DESCRIPTION_KEY)
  })

  it('METRIC sin la clave, o sin data, deja description en null', () => {
    expect(normalize(evidenceOf('METRIC', [{ key: 'paso.0', value: 'v' }]))['description']).toBe(
      null
    )
    expect(normalize(evidenceOf('METRIC', null))['description']).toBeNull()
    expect(normalize(evidenceOf('TRANSACTIONAL', []))['description']).toBeNull()
  })

  it('METRIC con la clave vacía o que no es texto deja description en null', () => {
    for (const value of ['', '   ', 42, null]) {
      const wire = normalize(evidenceOf('METRIC', [{ key: DESCRIPTION_KEY, value }]))
      expect(wire['description']).toBeNull()
      expect(evidenceWireSchema.safeParse(wire).success).toBe(true)
    }
  })

  it('en METRIC se conservan sus campos propios junto a la descripción', () => {
    const wire = normalize(evidenceOf('METRIC', [{ key: DESCRIPTION_KEY, value: MARKDOWN }]))
    expect(wire['metricId']).toBe('builtin:service.response.time')
    expect(wire['unit']).toBe('MicroSecond')
    expect(wire['valueBefore']).toBe(100_000)
    expect(wire['valueAfter']).toBe(300_000)
  })
})

/** Cadena del wire entera, para buscar un texto sin atarse al campo donde main lo deje. */
const wireText = (wire: Record<string, unknown>): string => JSON.stringify(wire)

describe('Decisión del Orquestador (0035): otras claves con «description» se tratan como descripción', () => {
  const OTHER_MD = '### Pasos\n\n- **reiniciar** el pool\n- avisar al `equipo`'

  it.each([
    ['METRIC', 'custom.description'],
    ['EVENT', 'Runbook.Description'],
    ['TRANSACTIONAL', 'descriptionExtra']
  ])('%s con %s: sale de las propiedades genéricas y su Markdown llega entero', (type, key) => {
    const evidence =
      type === 'EVENT'
        ? {
            evidenceType: 'EVENT',
            displayName: 'Evento',
            eventType: 'CUSTOM_INFO',
            startTime: 1791050000000,
            endTime: -1,
            data: {
              eventId: 'ev-0035',
              properties: [
                { key, value: OTHER_MD },
                { key: 'custom.owner', value: 'equipo-pagos' }
              ]
            }
          }
        : evidenceOf(type, [
            { key, value: OTHER_MD },
            { key: 'custom.owner', value: 'equipo-pagos' }
          ])
    const wire = normalize(evidence)
    expect(propertyKeys(wire)).not.toContain(key)
    // La clave sin «description» sigue como texto en la lista.
    expect(wire['properties']).toContainEqual({ key: 'custom.owner', text: 'equipo-pagos' })
    // El texto llega entero (no recortado a 300 como las propiedades genéricas), con su clave.
    expect(wireText(wire)).toContain(JSON.stringify(OTHER_MD).slice(1, -1))
    expect(wireText(wire)).toContain(key)
    // dt.event.description no se confunde con estas: no hay descripción principal.
    expect(wire['description']).toBeNull()
    expect(evidenceWireSchema.safeParse(wire).success).toBe(true)
  })

  it('una de más de 300 caracteres llega entera, no con el recorte de las propiedades', () => {
    const long = `# Larga\n\n${'texto '.repeat(200)}fin-larga`
    const wire = normalize(evidenceOf('METRIC', [{ key: 'custom.description', value: long }]))
    expect(propertyKeys(wire)).not.toContain('custom.description')
    expect(wireText(wire)).toContain('fin-larga')
    expect(evidenceWireSchema.safeParse(wire).success).toBe(true)
  })

  it('con el mismo límite que la «Descripción»: una de más de MAX_DESCRIPTION_LENGTH llega recortada', () => {
    const marker = 'MARCA-FINAL-0035'
    const long = `${'m'.repeat(MAX_DESCRIPTION_LENGTH)}${marker}`
    const wire = normalize(evidenceOf('METRIC', [{ key: 'custom.description', value: long }]))
    expect(propertyKeys(wire)).not.toContain('custom.description')
    expect(wireText(wire)).toContain('m'.repeat(MAX_DESCRIPTION_LENGTH))
    expect(wireText(wire)).not.toContain(marker)
    expect(evidenceWireSchema.safeParse(wire).success).toBe(true)
  })

  it('con dt.event.description y otra clave, cada una va a su sitio', () => {
    const wire = normalize(
      evidenceOf('METRIC', [
        { key: DESCRIPTION_KEY, value: MARKDOWN },
        { key: 'custom.description', value: OTHER_MD }
      ])
    )
    expect(wire['description']).toEqual({ text: MARKDOWN, truncated: false })
    expect(propertyKeys(wire)).not.toContain('custom.description')
    expect(wireText(wire)).toContain(JSON.stringify(OTHER_MD).slice(1, -1))
  })
})
