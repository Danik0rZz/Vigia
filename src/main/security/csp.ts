export interface CspOptions {
  /**
   * Origen del servidor de desarrollo de Vite (por ejemplo `http://localhost:5173`).
   * Solo se pasa en desarrollo; relaja lo mínimo para la recarga en caliente.
   */
  devServerOrigin?: string
}

/**
 * Política de seguridad de contenido de la interfaz.
 *
 * Si una librería necesita algo más, se amplía la directiva concreta y se anota
 * aquí el motivo. Nunca `unsafe-eval` ni orígenes remotos.
 */
export function buildCsp(options: CspOptions = {}): string {
  const { devServerOrigin } = options

  const scriptSrc = ["'self'"]
  const connectSrc = ["'self'"]

  if (devServerOrigin !== undefined) {
    // El plugin de React inserta un script en línea para la recarga en caliente,
    // y Vite abre un WebSocket contra su propio servidor.
    scriptSrc.push("'unsafe-inline'")
    connectSrc.push(devServerOrigin.replace(/^http/, 'ws'))
  }

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    // Librerías de interfaz que inyectan estilos en línea.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'", 'data:'],
    'worker-src': ["'self'", 'blob:'],
    'connect-src': connectSrc,
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"]
  }

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}
