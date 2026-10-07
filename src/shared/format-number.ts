/**
 * Número de la interfaz con el formato del idioma y separador de miles siempre (ficha 0012):
 * en español Intl no agrupa los de 4 cifras («9907»), y Dani lo quiere como «9.907». Todos los
 * números que se enseñan pasan por aquí (lo vigila `format-number.test.ts`); las exportaciones
 * XLSX llevan números, no texto, y no cambian.
 */
export function formatNumber(
  value: number,
  language: string,
  options: Intl.NumberFormatOptions = {}
): string {
  return new Intl.NumberFormat(language, { ...options, useGrouping: 'always' }).format(value)
}
