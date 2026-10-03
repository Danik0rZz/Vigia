/** Variable con la que las pruebas fijan la carpeta de exportación (sin diálogo). */
export const EXPORT_DIR_ENV = 'VIGIA_EXPORT_DIR'

/**
 * Carpeta donde se guardan exportaciones y capturas sin preguntar. Solo sin
 * empaquetar (pruebas e2e): en la app empaquetada se ignora siempre y se usa el
 * diálogo de guardado, para que nadie pueda redirigir los ficheros.
 */
export function resolveExportDir(options: {
  packaged: boolean
  override: string | undefined
}): string | null {
  if (options.packaged) return null
  const override = options.override?.trim()
  return override === undefined || override === '' ? null : override
}
