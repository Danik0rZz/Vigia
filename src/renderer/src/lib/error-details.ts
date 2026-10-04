import { maskErrorDetails } from '@shared/error-report'
import { describeError } from './error-log'

export type ErrorVariant = 'unexpected' | 'updated' | 'notFound'
/** Por qué se pide recargar: un trozo de la interfaz que falta o una recarga en caliente (dev). */
export type UpdatedReason = 'chunk' | 'hot'

/** Texto de los detalles técnicos, ya enmascarado (sin secretos ni usuario en rutas). */
export function errorDetailsText(error: unknown, route: string, version: string): string {
  const { message, stack } = describeError(error)
  const lines = [message, '', stack ?? '', '', `route: ${route}`, `version: ${version}`]
  return maskErrorDetails(
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}
