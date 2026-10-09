/**
 * Valores de `properties` de una entidad que nunca salen de main (ficha 0029): la línea de
 * comandos, los argumentos, las variables de entorno y las rutas completas del ejecutable de un
 * proceso pueden llevar contraseñas, tokens o el nombre del usuario. Se quitan antes de pasar la
 * entidad a texto, así que no llegan ni a las filas de la tarjeta ni a «Todas las propiedades».
 *
 * Formas que se filtran, en cualquier tipo de entidad:
 * - Una propiedad (o un campo de un objeto anidado) cuya clave es de las de abajo.
 * - Una entrada `{ key, value }` de una lista (así llega `metadata` de un proceso, visto en vivo en
 *   la 0027) cuya `key` es de las de abajo.
 *
 * Claves (se comparan en minúsculas y sin `_`, `-`, `.` ni espacios):
 * - `COMMAND_LINE_ARGS` y `EXE_PATH` de `metadata` (vistas en vivo en la 0027) y
 *   `DOTNET_COMMAND` y `DOTNET_COMMAND_PATH` (mismo enum de la Configuration API: el comando de
 *   .NET y su ruta).
 * - Cualquier clave que contenga `commandline`, `cmdline`, `commandpath`, `exepath`,
 *   `environmentvariable` o `envvar` (`commandLine`, `environmentVariables`…), y las claves
 *   exactas `args`, `arguments`, `argv`, `env` y `environment`.
 * - Las claves exactas `logFileStatus`, `logPathLastUpdate` y `logSourceState` (ficha 0041, regla
 *   de Dani: no se enseñan rutas de ficheros de log): son listas de `{ key, value }` cuya `key` es
 *   la ruta del fichero de log o el nombre de la fuente. Se quita la propiedad entera (sin la
 *   clave, sus valores no dicen de qué fichero son); su estado se ve en la tarjeta «Logs» del host.
 */

const HIDDEN_PARTS = [
  'commandline',
  'cmdline',
  'commandpath',
  'exepath',
  'environmentvariable',
  'envvar'
] as const

const HIDDEN_EXACT = new Set([
  'args',
  'arguments',
  'argv',
  'env',
  'environment',
  'dotnetcommand',
  // Ficha 0041: propiedades de logs de un proceso, con las rutas en sus claves.
  'logfilestatus',
  'logpathlastupdate',
  'logsourcestate'
])

/** Profundidad máxima que se recorre (la de `propertyText`: más abajo no se pasa a texto). */
const MAX_DEPTH = 4

const normalize = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Si el valor de esta clave nunca debe salir de main. */
export function isHiddenPropertyKey(key: string): boolean {
  const normalized = normalize(key)
  return HIDDEN_EXACT.has(normalized) || HIDDEN_PARTS.some((part) => normalized.includes(part))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Entrada `{ key, value }` de una lista con una clave oculta. */
const isHiddenEntry = (value: unknown): boolean =>
  isRecord(value) && typeof value['key'] === 'string' && isHiddenPropertyKey(value['key'])

/** El valor sin sus partes ocultas (las listas pierden esas entradas; los objetos, esos campos). */
export function withoutHiddenValues(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) return Array.isArray(value) || isRecord(value) ? null : value
  if (Array.isArray(value)) {
    return value
      .filter((item) => !isHiddenEntry(item))
      .map((item) => withoutHiddenValues(item, depth + 1))
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isHiddenPropertyKey(key))
        .map(([key, item]) => [key, withoutHiddenValues(item, depth + 1)])
    )
  }
  return value
}
