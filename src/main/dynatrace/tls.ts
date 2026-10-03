import type { CertificateLevel } from '@shared/tenants'

export type CertificateDecision = 'accept' | 'reject' | 'chromium'

/**
 * Decide qué hacer con el certificado de un host según el nivel del entorno:
 * - system: lo que diga Chromium (CA de Windows).
 * - pinned: si el host tiene huella fijada, solo vale esa (aunque Chromium lo
 *   acepte); si no la tiene (por ejemplo, el SSO público), lo que diga Chromium.
 * - ignore: se aceptan los hosts del propio entorno (API clásica y plataforma).
 *   Nunca se aplica al SSO ni a otros hosts, que se tratan como en "pinned":
 *   el SSO recibe el client secret y siempre se valida o se fija su huella.
 */
export function verifyCertificate(input: {
  level: CertificateLevel
  pins: string[]
  fingerprint: string
  chromiumOk: boolean
  /** Nombre del host, sin puerto. */
  hostname: string
  /** Nombres de host de las URL del entorno (API clásica y plataforma). */
  envHosts: string[]
}): CertificateDecision {
  if (input.level === 'system') return 'chromium'
  if (input.level === 'ignore' && input.envHosts.includes(input.hostname)) return 'accept'
  if (input.pins.length === 0) return 'chromium'
  return input.pins.includes(input.fingerprint) ? 'accept' : 'reject'
}
