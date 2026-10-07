import type { FormatterModule, InitOptions } from 'i18next'
import { formatNumber } from '@shared/format-number'

/**
 * Números interpolados en los textos de i18next (avisos, recuentos, «Ver todos (N)»…) con el
 * separador de miles de `formatNumber` (ficha 0012). Sustituye al formateador de i18next: con
 * `alwaysFormat`, cada `{{variable}}` pasa por aquí. Un número se formatea; lo demás (textos ya
 * formateados o que vienen de Dynatrace) se deja tal cual. `count` sigue eligiendo el plural:
 * i18next lo lee de las opciones, no del texto.
 *
 * Los textos no usan formatos con nombre (`{{x, number}}`), así que `add` y `addCached` no
 * registran nada.
 */
export const numberFormatter: FormatterModule = {
  type: 'formatter',
  init: () => undefined,
  add: () => undefined,
  addCached: () => undefined,
  // Lo que no es un número vuelve tal cual (también null o undefined, que i18next trata después
  // como valor ausente): el tipo de i18next dice string, pero recibe cualquier valor.
  format: (value: unknown, _format, lng): string =>
    typeof value === 'number' && Number.isFinite(value)
      ? formatNumber(value, lng ?? 'es')
      : (value as string)
}

/** Interpolación de la app: sin escapar (React ya escapa) y todo por `numberFormatter`. */
export const I18N_INTERPOLATION: NonNullable<InitOptions['interpolation']> = {
  escapeValue: false,
  alwaysFormat: true
}
