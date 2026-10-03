import { APP_ID } from '@shared/app'

/**
 * User-Agent solo con caracteres ASCII. Electron incluye en él el nombre de la
 * app, y la tilde de "Vigía" no es válida en una cabecera HTTP: con ella fallan
 * las peticiones al protocolo `app://` y fallarían las llamadas a Dynatrace.
 */
export function asciiUserAgent(
  defaultUserAgent: string,
  appName: string,
  appVersion: string
): string {
  return defaultUserAgent
    .replace(`${appName}/${appVersion}`, `${APP_ID}/${appVersion}`)
    .replace(/[^\x20-\x7E]/g, '')
}
