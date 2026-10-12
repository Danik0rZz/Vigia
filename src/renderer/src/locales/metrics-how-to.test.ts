import { describe, expect, it } from 'vitest'
import enCommon from './en/common.json'
import esCommon from './es/common.json'

/**
 * Ficha 0109 (CA3): descripción de uso de Métricas, `metrics.howTo`, en es y en. Contrato elegido
 * al escribir los tests: el ejemplo del selector llega por interpolación (`{{example}}`) dentro de
 * la etiqueta `<code>` de `Trans`, así no se repite en cada idioma y la cadena no lleva HTML.
 */

type Messages = { [key: string]: unknown }

function howTo(messages: unknown): string {
  const block = (messages as Messages)['metrics'] as Messages | undefined
  const value = block?.['howTo']
  return typeof value === 'string' ? value : ''
}

/** Interpolaciones `{{…}}` de un texto, ordenadas. */
function interpolations(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((match) => match[1] ?? '').sort()
}

/** Etiquetas `<x>` y `</x>` de un texto, ordenadas. */
function tags(text: string): string[] {
  return [...text.matchAll(/<\/?[a-zA-Z0-9]+\s*\/?>/g)].map((match) => match[0]).sort()
}

describe('CA3 (0109): metrics.howTo en es y en', () => {
  // Sin la clave, el texto queda vacío y falla el primer test (no la carga del fichero).
  const es = howTo(esCommon)
  const en = howTo(enCommon)

  it('existe y no está vacío en los dos idiomas', () => {
    expect(es.trim()).not.toBe('')
    expect(en.trim()).not.toBe('')
    expect(en).not.toBe(es)
  })

  it('tiene las mismas interpolaciones y etiquetas en es y en', () => {
    expect(interpolations(en)).toEqual(interpolations(es))
    expect(tags(en)).toEqual(tags(es))
  })

  it('el ejemplo del selector va una vez, dentro de <code>, en los dos idiomas', () => {
    for (const text of [es, en]) {
      expect(text.match(/<code>\{\{example\}\}<\/code>/g) ?? []).toHaveLength(1)
      expect(interpolations(text)).toEqual(['example'])
      expect(tags(text)).toEqual(['</code>', '<code>'])
    }
  })

  it('el texto en español es el aprobado por Dani', () => {
    expect(es).toBe(
      'Busca una métrica por su nombre o escribe un selector, por ejemplo <code>{{example}}</code>. ' +
        'Elige la resolución y pulsa Consultar: se usa el rango de tiempo de la barra superior. ' +
        'Puedes exportar el gráfico y guardar la consulta para este entorno; las guardadas se abren ' +
        'también con Ctrl+K.'
    )
  })

  it('nombra el botón con el mismo texto que tiene en cada idioma', () => {
    const runEs = String((esCommon as { metrics: Messages }).metrics['run'])
    const runEn = String((enCommon as { metrics: Messages }).metrics['run'])
    expect(es).toContain(runEs)
    expect(en).toContain(runEn)
    expect(en).toContain('Ctrl+K')
  })
})
