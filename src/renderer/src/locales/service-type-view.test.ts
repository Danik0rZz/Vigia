import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0047: textos nuevos de la página del servicio por tipo, en `common`, en es y en:
 * - `entities.service.serviceTypes.<serviceType>`: nombre legible de cada tipo de la tabla;
 * - `entities.service.metricSetNote.<activity|client|unified|fallback>` y su `…Hint` (tooltip);
 * - `entities.service.markers.requests` («Peticiones», marcador de Solo actividad) y
 *   `entities.service.charts.series.requests` (la serie única del gráfico de actividad).
 * La paridad general ya la mira `locales.test.ts`; esto comprueba que los de esta ficha existen
 * en los dos idiomas, con los textos que da la ficha en español.
 */
type Messages = { [key: string]: string | Messages }

function at(messages: unknown, path: string): unknown {
  let node: unknown = messages
  for (const part of path.split('.')) {
    node = (node as Messages | undefined)?.[part]
  }
  return node
}

const NOTES = ['activity', 'client', 'unified', 'fallback'] as const

/** Los textos que da la ficha, en español. */
const TEXTS_ES: Record<string, string> = {
  'entities.service.metricSetNote.activity': 'Este tipo de servicio solo mide actividad',
  'entities.service.metricSetNote.client': 'Medido desde los clientes',
  'entities.service.metricSetNote.unified': 'Métricas unificadas',
  'entities.service.markers.requests': 'Peticiones'
}

describe('CA6 (0047): textos nuevos de la vista por tipo en es y en', () => {
  it('los textos de la ficha, en español', () => {
    for (const [key, text] of Object.entries(TEXTS_ES)) {
      expect(at(es, key), `${key} (es)`).toBe(text)
    }
  })

  it('cada nota y su tooltip, en los dos idiomas y sin vacíos; el inglés, traducido', () => {
    for (const note of NOTES) {
      for (const key of [
        `entities.service.metricSetNote.${note}`,
        `entities.service.metricSetNote.${note}Hint`
      ]) {
        const textEs = at(es, key)
        const textEn = at(en, key)
        expect(typeof textEs, `${key} (es)`).toBe('string')
        expect(typeof textEn, `${key} (en)`).toBe('string')
        expect((textEs as string).trim(), `${key} (es)`).not.toBe('')
        expect((textEn as string).trim(), `${key} (en)`).not.toBe('')
        expect(textEn, `${key}: en igual que es`).not.toBe(textEs)
      }
    }
  })

  it('la serie de peticiones y el marcador, en inglés', () => {
    for (const key of [
      'entities.service.markers.requests',
      'entities.service.charts.series.requests'
    ]) {
      expect(typeof at(en, key), `${key} (en)`).toBe('string')
      expect((at(en, key) as string).trim(), `${key} (en)`).not.toBe('')
      expect(typeof at(es, key), `${key} (es)`).toBe('string')
    }
  })

  it('un nombre por tipo de la tabla, en es y en', () => {
    for (const type of [
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
    ]) {
      const key = `entities.service.serviceTypes.${type}`
      expect(typeof at(es, key), `${key} (es)`).toBe('string')
      expect(typeof at(en, key), `${key} (en)`).toBe('string')
    }
  })
})
