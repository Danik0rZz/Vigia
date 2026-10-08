import i18next, { type TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { I18N_INTERPOLATION, numberFormatter } from '../app/i18n-numbers'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0020, revisión: el «+N» de las IPs (host) y de las etiquetas (servicio y host) tiene su
 * texto en singular y en plural (`_one`/`_other`), en es y en: nada de «Ver las 1 IP restantes».
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

describe('CA6 (0020): plural del «+N» de IPs y etiquetas en es y en', () => {
  it('en español, con 1 y con 3', async () => {
    const t = await appT('es')
    expect(t('entities.host.info.ipsMore', { count: 1 })).toBe('Ver la IP restante')
    expect(t('entities.host.info.ipsMore', { count: 3 })).toBe('Ver las 3 IP restantes')
    expect(t('entities.service.info.tagsMore', { count: 1 })).toBe('Ver la etiqueta restante')
    expect(t('entities.service.info.tagsMore', { count: 3 })).toBe('Ver las 3 etiquetas restantes')
  })

  it('en inglés, con 1 y con 3', async () => {
    const t = await appT('en')
    expect(t('entities.host.info.ipsMore', { count: 1 })).toBe('Show the remaining IP address')
    expect(t('entities.host.info.ipsMore', { count: 3 })).toBe('Show the remaining 3 IP addresses')
    expect(t('entities.service.info.tagsMore', { count: 1 })).toBe('Show the remaining tag')
    expect(t('entities.service.info.tagsMore', { count: 3 })).toBe('Show the remaining 3 tags')
  })
})
