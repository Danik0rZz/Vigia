import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import es from '../locales/es.json'
import { usePreferences, type Language } from './preferences'

function applyLanguage(language: Language): void {
  document.documentElement.lang = language
}

/**
 * Arranca i18next con el idioma guardado y lo mantiene sincronizado con las
 * preferencias y con el atributo `lang` del documento.
 */
export function initI18n(): void {
  const { language } = usePreferences.getState()
  void i18n.use(initReactI18next).init({
    resources: { es: { translation: es }, en: { translation: en } },
    lng: language,
    fallbackLng: 'es',
    interpolation: { escapeValue: false }
  })
  applyLanguage(language)

  usePreferences.subscribe((state, previous) => {
    if (state.language === previous.language) return
    void i18n.changeLanguage(state.language)
    applyLanguage(state.language)
  })
}
