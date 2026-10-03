import { environmentTypes, type EnvironmentType } from '@shared/tenants'

interface LabelledEnvironment {
  id: string
  name: string
  type: string
}

/**
 * Etiqueta de un entorno en la ruta, el selector y Ctrl+K: el tipo traducido
 * ("Producción"), con " · <nombre>" si el cliente tiene más de uno de ese tipo.
 * Los de tipo "otro" se ven por su nombre. `siblings` son los entornos del mismo
 * cliente; el propio entorno cuenta aunque no venga.
 */
export function environmentLabel(
  env: LabelledEnvironment,
  siblings: readonly LabelledEnvironment[],
  typeLabel: (type: string) => string
): string {
  if (env.type === 'other') return env.name
  const sameType = new Set(
    [env, ...siblings].filter((other) => other.type === env.type).map((other) => other.id)
  )
  return sameType.size > 1 ? `${typeLabel(env.type)} · ${env.name}` : typeLabel(env.type)
}

/** Orden fijo de los tipos en el selector y en Ctrl+K: de Producción a Otro. */
export function compareEnvironments(a: LabelledEnvironment, b: LabelledEnvironment): number {
  const rank = (type: string): number => {
    const index = environmentTypes.indexOf(type as EnvironmentType)
    return index === -1 ? environmentTypes.length : index
  }
  return rank(a.type) - rank(b.type) || a.name.localeCompare(b.name, 'es')
}
