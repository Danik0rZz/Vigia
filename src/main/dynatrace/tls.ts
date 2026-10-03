import type { CertificateLevel } from '@shared/tenants'

export type CertificateDecision = 'accept' | 'reject' | 'chromium'

/**
 * Decide qué hacer con el certificado de un host según el nivel del entorno:
 * - system: lo que diga Chromium (CA de Windows).
 * - pinned: si el host tiene huella fijada, solo vale esa (aunque Chromium lo
 *   acepte); si no la tiene (por ejemplo, el SSO público), lo que diga Chromium.
 * - ignore: se acepta todo, solo en la sesión de ese entorno.
 */
export function verifyCertificate(input: {
  level: CertificateLevel
  pins: string[]
  fingerprint: string
  chromiumOk: boolean
}): CertificateDecision {
  switch (input.level) {
    case 'system':
      return 'chromium'
    case 'ignore':
      return 'accept'
    case 'pinned':
      if (input.pins.length === 0) return 'chromium'
      return input.pins.includes(input.fingerprint) ? 'accept' : 'reject'
  }
}
