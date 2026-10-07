import i18next, { type TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import en from '../locales/en/common.json'
import es from '../locales/es/common.json'
import { I18N_INTERPOLATION, numberFormatter } from './i18n-numbers'

/**
 * Ficha 0012: los números que se interpolan en los textos de i18next (avisos, recuentos) pasan por
 * `formatNumber`, como los demás: con la configuración de la app (`numberFormatter` e
 * `I18N_INTERPOLATION`), 1234 se pinta «1.234» en español y «1,234» en inglés.
 */
async function appT(lng: 'es' | 'en'): Promise<TFunction> {
  const instance = i18next.createInstance()
  await instance.use(numberFormatter).init({
    lng,
    resources: { [lng]: { common: lng === 'es' ? es : en } },
    defaultNS: 'common',
    interpolation: I18N_INTERPOLATION
  })
  return instance.getFixedT(lng)
}

describe('Separador en textos (0012): números de los textos de i18next con separador de miles', () => {
  it('Separador en textos (0012): un aviso con {{shown}} y {{total}} en español: «1.234»', async () => {
    const t = await appT('es')
    expect(t('problems.recentComments', { shown: 1000, total: 1234 })).toBe(
      'Se ven los 1.000 más recientes de 1.234 comentarios.'
    )
  })

  it('Separador en textos (0012): en inglés: «1,234»', async () => {
    const t = await appT('en')
    expect(t('problems.apiTruncatedEvidence', { shown: 500, total: 1234 })).toContain('1,234')
  })

  it('Separador en textos (0012): {{count}} se formatea y sigue eligiendo el plural', async () => {
    const t = await appT('es')
    expect(t('problems.showAllComments', { count: 1234 })).toBe('Ver todos (1.234)')
    expect(t('module.invalidItems', { count: 1 })).toBe(
      '1 elemento no se pudo leer y no se muestra.'
    )
    expect(t('module.invalidItems', { count: 2500 })).toBe(
      '2.500 elementos no se pudieron leer y no se muestran.'
    )
  })

  it('Separador en textos (0012): en inglés, el plural también: «1 item» y «2,500 items»', async () => {
    const t = await appT('en')
    expect(t('module.invalidItems', { count: 1 })).toBe(
      '1 item could not be read and is not shown.'
    )
    expect(t('module.invalidItems', { count: 2500 })).toBe(
      '2,500 items could not be read and are not shown.'
    )
  })

  it('Separador en textos (0012): los textos (ya formateados o de Dynatrace) no se tocan', async () => {
    const t = await appT('es')
    expect(t('problems.recentComments', { shown: '2', total: '1234' })).toBe(
      'Se ven los 2 más recientes de 1234 comentarios.'
    )
  })
})
