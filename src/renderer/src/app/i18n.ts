import i18n, { type Resource } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { usePreferences, type Language } from './preferences'

/** Namespace de la navegación, la barra superior, Ajustes y la tarjeta de estado. */
export const DEFAULT_NAMESPACE = 'common'

/**
 * Textos por idioma y namespace: `locales/<idioma>/<namespace>.json`. Cada
 * módulo añade su fichero y se carga sin registrarlo aquí.
 */
function loadResources(): Resource {
  const files = import.meta.glob<Record<string, unknown>>('../locales/*/*.json', {
    eager: true,
    import: 'default'
  })
  const resources: Resource = {}
  for (const [path, messages] of Object.entries(files)) {
    const match = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path)
    if (match === null) continue
    const [, language, namespace] = match as unknown as [string, string, string]
    resources[language] = { ...resources[language], [namespace]: messages }
  }
  return resources
}

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
    resources: loadResources(),
    defaultNS: DEFAULT_NAMESPACE,
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
