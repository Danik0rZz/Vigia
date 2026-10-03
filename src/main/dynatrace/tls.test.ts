import { describe, expect, it } from 'vitest'
import { verifyCertificate } from './tls'

/**
 * Decisión de verificación de certificados por nivel (spec, "Certificados TLS"):
 * 'chromium' deja la decisión a Chromium, 'accept' y 'reject' la fuerzan.
 */

const PIN = 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const OTHER = 'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='

describe('verifyCertificate', () => {
  it.each([true, false])('system deja decidir a Chromium (chromiumOk=%s)', (chromiumOk) => {
    expect(
      verifyCertificate({ level: 'system', pins: [PIN], fingerprint: OTHER, chromiumOk })
    ).toBe('chromium')
  })

  it.each([true, false])('ignore acepta siempre (chromiumOk=%s)', (chromiumOk) => {
    expect(verifyCertificate({ level: 'ignore', pins: [], fingerprint: OTHER, chromiumOk })).toBe(
      'accept'
    )
  })

  it('pinned acepta la huella fijada aunque Chromium no confíe en el certificado', () => {
    expect(
      verifyCertificate({ level: 'pinned', pins: [PIN], fingerprint: PIN, chromiumOk: false })
    ).toBe('accept')
  })

  it('pinned rechaza otra huella aunque Chromium la dé por buena', () => {
    expect(
      verifyCertificate({ level: 'pinned', pins: [PIN], fingerprint: OTHER, chromiumOk: true })
    ).toBe('reject')
  })

  it('pinned sin huellas para ese host deja decidir a Chromium (por ejemplo, el SSO público)', () => {
    expect(
      verifyCertificate({ level: 'pinned', pins: [], fingerprint: OTHER, chromiumOk: true })
    ).toBe('chromium')
  })
})
