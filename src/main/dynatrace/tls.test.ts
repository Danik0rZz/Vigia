import { describe, expect, it } from 'vitest'
import { verifyCertificate } from './tls'

/**
 * Decisión de verificación de certificados por nivel (spec, "Certificados TLS"):
 * 'chromium' deja la decisión a Chromium, 'accept' y 'reject' la fuerzan.
 *
 * Con 'ignore' solo se aceptan los hosts del propio entorno (API clásica y
 * plataforma). El SSO, que recibe el client_secret, y cualquier otro host los
 * sigue verificando Chromium.
 */

const PIN = 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const OTHER = 'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='
const ENV_HOSTS = ['abc12345.live.dynatrace.com', 'abc12345.apps.dynatrace.com']

type Input = Parameters<typeof verifyCertificate>[0]

function check(overrides: Partial<Input>): ReturnType<typeof verifyCertificate> {
  return verifyCertificate({
    level: 'system',
    pins: [],
    fingerprint: OTHER,
    chromiumOk: false,
    hostname: 'abc12345.live.dynatrace.com',
    envHosts: ENV_HOSTS,
    ...overrides
  } as Input)
}

describe('verifyCertificate', () => {
  it.each([true, false])('system deja decidir a Chromium (chromiumOk=%s)', (chromiumOk) => {
    expect(check({ level: 'system', pins: [PIN], chromiumOk })).toBe('chromium')
  })

  describe('ignore', () => {
    it.each(ENV_HOSTS)('acepta un host del entorno (%s), confíe Chromium o no', (hostname) => {
      expect(check({ level: 'ignore', hostname, chromiumOk: false })).toBe('accept')
      expect(check({ level: 'ignore', hostname, chromiumOk: true })).toBe('accept')
    })

    it.each([
      ['el SSO', 'sso.dynatrace.com'],
      ['un host ajeno', 'otro.ejemplo.local'],
      ['un subdominio parecido', 'abc12345.live.dynatrace.com.atacante.local'],
      ['localhost frente a 127.0.0.1', 'localhost']
    ])('con %s deja decidir a Chromium', (_case, hostname) => {
      expect(
        check({
          level: 'ignore',
          hostname,
          envHosts: [...ENV_HOSTS, '127.0.0.1'],
          chromiumOk: false
        })
      ).toBe('chromium')
    })

    it('un host ajeno con huella fijada (por ejemplo, el SSO) se trata como pinned', () => {
      const sso = { level: 'ignore' as const, pins: [PIN], hostname: 'sso.ejemplo.local' }
      expect(check({ ...sso, fingerprint: PIN, chromiumOk: false })).toBe('accept')
      expect(check({ ...sso, fingerprint: OTHER, chromiumOk: true })).toBe('reject')
      expect(check({ ...sso, fingerprint: OTHER, chromiumOk: false })).toBe('reject')
    })

    it('un host del entorno se acepta aunque tenga fijada otra huella', () => {
      expect(check({ level: 'ignore', pins: [PIN], fingerprint: OTHER, chromiumOk: false })).toBe(
        'accept'
      )
    })

    it('sin hosts del entorno deja decidir a Chromium', () => {
      expect(check({ level: 'ignore', envHosts: [] })).toBe('chromium')
    })
  })

  describe('pinned', () => {
    it('acepta la huella fijada aunque Chromium no confíe en el certificado', () => {
      expect(check({ level: 'pinned', pins: [PIN], fingerprint: PIN, chromiumOk: false })).toBe(
        'accept'
      )
    })

    it('rechaza otra huella aunque Chromium la dé por buena', () => {
      expect(check({ level: 'pinned', pins: [PIN], fingerprint: OTHER, chromiumOk: true })).toBe(
        'reject'
      )
    })

    it('sin huellas para ese host deja decidir a Chromium (por ejemplo, el SSO público)', () => {
      expect(
        check({ level: 'pinned', pins: [], hostname: 'sso.dynatrace.com', chromiumOk: true })
      ).toBe('chromium')
    })

    it('un SSO con huella fijada solo se acepta con esa huella', () => {
      const sso = { level: 'pinned' as const, pins: [PIN], hostname: 'sso.ejemplo.local' }
      expect(check({ ...sso, fingerprint: PIN, chromiumOk: false })).toBe('accept')
      expect(check({ ...sso, fingerprint: OTHER, chromiumOk: true })).toBe('reject')
    })
  })
})
