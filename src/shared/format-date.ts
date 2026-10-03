const two = (value: number): string => String(value).padStart(2, '0')

/**
 * Fecha y hora en hora local, con los formatos fijos que pidió Dani:
 * es "dd/mm/aaaa HH:mm" y en "yyyy-mm-dd HH:mm" (24 h). No usa Intl, para no
 * depender de su formato por defecto; la conversión a hora local la hace Date.
 */
export function formatDateTime(ms: number, lang: 'es' | 'en'): string {
  const date = new Date(ms)
  const day = two(date.getDate())
  const month = two(date.getMonth() + 1)
  const year = String(date.getFullYear())
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`
  return lang === 'es' ? `${day}/${month}/${year} ${time}` : `${year}-${month}-${day} ${time}`
}
