import type { JSX } from 'react'
import { useParams } from 'react-router'

/**
 * Provoca la pantalla de error de cada variante (solo en modo e2e, ver
 * buildRoutes): así se prueban y se pueden ver en desarrollo.
 */
export function ErrorTrigger(): JSX.Element {
  const { variant = '' } = useParams()
  if (variant === 'chunk') {
    throw new TypeError(
      'Failed to fetch dynamically imported module: app://vigia/assets/prueba-disparador.js'
    )
  }
  throw new Error(`Error de prueba del disparador (${variant})`)
}
