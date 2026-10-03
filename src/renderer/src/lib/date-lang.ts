/** "es" o "en" para las fechas con formato propio (formatDateTime). */
export function dateLang(language: string): 'es' | 'en' {
  return language.startsWith('en') ? 'en' : 'es'
}
