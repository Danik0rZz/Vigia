import { expect, test } from '@playwright/test'
import { currentRoute, page, setupViewsApp } from './views/harness'

/**
 * Ficha 0079: Inicio como primera vista de la app recién arrancada. El arnés de vistas lanza una app
 * por worker y spec, crea los entornos en el nivel de certificado «ignorar» contra el Dynatrace
 * simulado y, en el `beforeEach`, activa Producción y recarga en Inicio: es la primera vez que la
 * app pide datos a ese entorno, con problemas y SLOs a la vez.
 *
 * Este spec tiene un solo test a propósito, para que sea siempre el primero de su app. Con
 * `--repeat-each`, cada repetición corre en su propio worker y arranca su propia app.
 */

setupViewsApp()

const UNTRUSTED = 'Certificado no de confianza'

test(
  'CA1 (0079): recién arrancada, Inicio carga problemas abiertos y SLOs sin «Certificado no de confianza»',
  { tag: '@inicio' },
  async () => {
    // Primera vista: Inicio, sin pasar por otra (resetState la deja en «#/»).
    expect(await currentRoute()).toBe('/')

    const problems = page.getByTestId('kpi-open-problems')
    const slos = page.getByTestId('kpi-slos')
    await expect(problems).toContainText('2')
    await expect(slos).toContainText('Disponibilidad pagos')
    await expect(slos).toContainText('Latencia carrito')

    await expect(problems, 'panel de problemas abiertos').not.toContainText(UNTRUSTED)
    await expect(slos, 'panel de SLOs').not.toContainText(UNTRUSTED)
    await expect(page.getByText(UNTRUSTED), 'ningún aviso de certificado en Inicio').toHaveCount(0)
  }
)
