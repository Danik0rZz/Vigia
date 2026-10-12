import { describe, expect, it } from 'vitest'
import { pointsToSimulator } from '../e2e/evidence'

/**
 * Ficha 0107, CA4: `captureEvidence` (`e2e/evidence.ts`) solo captura si la app apunta al
 * simulador local de los e2e (HTTPS en 127.0.0.1, `e2e/views/simulator.ts`). Lo decide la función
 * pura `pointsToSimulator(url)`, que recibe la URL del entorno al que apunta la app (o nada, si no
 * hay entorno) y devuelve si es la del simulador. Si devuelve false, `captureEvidence` no guarda
 * nada y lo dice en el log del test.
 *
 * Las URL de fuera son de ejemplo (dominios reservados o con forma de tenant inventada), nunca del
 * tenant de pruebas.
 */

describe('CA4 (0107): pointsToSimulator decide si la app apunta al simulador', () => {
  it.each(['https://127.0.0.1:43210', 'https://127.0.0.1:43210/', 'https://127.0.0.1:9443/api/v2'])(
    'CA4 (0107): %s es el simulador',
    (url) => {
      expect(pointsToSimulator(url)).toBe(true)
    }
  )

  it.each([
    'https://abc12345.live.dynatrace.com',
    'https://abc12345.apps.dynatrace.com',
    'https://dynatrace.example.com/e/00000000-0000-0000-0000-000000000000',
    'https://127.0.0.1.example.com',
    'https://example.com/?api=https://127.0.0.1:43210',
    'https://10.0.0.5:9999'
  ])('CA4 (0107): %s no es el simulador', (url) => {
    expect(pointsToSimulator(url)).toBe(false)
  })

  it.each([null, undefined, '', 'no es una url'])(
    'CA4 (0107): sin URL válida (%s) no es el simulador',
    (url) => {
      expect(pointsToSimulator(url)).toBe(false)
    }
  )
})
