import { describe, expect, it } from 'vitest'
import {
  certificateLevels,
  clientInputSchema,
  configFileSchema,
  deployments,
  environmentInputSchema,
  environmentTypes,
  httpsUrlSchema,
  secretKinds
} from './tenants'

/** Esquemas de clientes y entornos, compartidos por main y la interfaz. */

const CLIENT_ID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b'

/** Entorno SaaS válido; cada prueba cambia solo lo que comprueba. */
function saasEnvironment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: CLIENT_ID,
    name: 'Producción',
    type: 'production',
    deployment: 'saas',
    classicApiUrl: 'https://abc12345.live.dynatrace.com',
    platformUrl: 'https://abc12345.apps.dynatrace.com',
    ssoUrl: 'https://sso.dynatrace.com',
    oauthClientId: 'dt0s02.EJEMPLO',
    oauthScopes: ['storage:logs:read'],
    accountUuid: '7a1b2c3d-0000-4000-8000-000000000000',
    certificateLevel: 'system',
    captureUrlPatterns: [],
    tags: ['core'],
    readOnly: false,
    ...overrides
  }
}

describe('enums', () => {
  it('tienen los valores acordados, en orden', () => {
    expect(environmentTypes).toEqual([
      'production',
      'preproduction',
      'integration',
      'development',
      'other'
    ])
    expect(deployments).toEqual(['saas', 'managed'])
    expect(certificateLevels).toEqual(['system', 'pinned', 'ignore'])
    expect(secretKinds).toEqual(['classicToken', 'oauthClientSecret', 'platformToken'])
  })
})

describe('httpsUrlSchema', () => {
  it('acepta https y quita la "/" final', () => {
    expect(httpsUrlSchema.parse('https://abc12345.live.dynatrace.com/')).toBe(
      'https://abc12345.live.dynatrace.com'
    )
    expect(httpsUrlSchema.parse('https://dt.ejemplo.local/e/abc-123/')).toBe(
      'https://dt.ejemplo.local/e/abc-123'
    )
    expect(httpsUrlSchema.parse('https://abc12345.live.dynatrace.com')).toBe(
      'https://abc12345.live.dynatrace.com'
    )
  })

  it.each([
    ['http', 'http://abc12345.live.dynatrace.com'],
    ['ftp', 'ftp://abc12345.live.dynatrace.com'],
    ['vacía', ''],
    ['sin formato de URL', 'not a url'],
    ['con usuario y contraseña', 'https://user:pw@abc12345.live.dynatrace.com'],
    ['solo con usuario', 'https://user@abc12345.live.dynatrace.com'],
    ['con hash', 'https://abc12345.live.dynatrace.com/#/ui']
  ])('rechaza una URL %s', (_case, url) => {
    expect(httpsUrlSchema.safeParse(url).success).toBe(false)
  })
})

describe('clientInputSchema', () => {
  it('acepta un nombre con espacios alrededor (los quita) y un color #rrggbb', () => {
    expect(clientInputSchema.parse({ name: '  Cliente A  ', color: '#1A2b3C' })).toEqual({
      name: 'Cliente A',
      color: '#1A2b3C'
    })
  })

  it.each([
    ['nombre vacío', { name: '   ', color: '#112233' }],
    ['nombre de 81 caracteres', { name: 'x'.repeat(81), color: '#112233' }],
    ['color corto', { name: 'A', color: '#123' }],
    ['color sin #', { name: 'A', color: '112233' }],
    ['color con nombre', { name: 'A', color: 'red' }],
    ['color no hexadecimal', { name: 'A', color: '#12345g' }]
  ])('rechaza %s', (_case, input) => {
    expect(clientInputSchema.safeParse(input).success).toBe(false)
  })

  it('acepta un nombre de 80 caracteres', () => {
    expect(clientInputSchema.safeParse({ name: 'x'.repeat(80), color: '#112233' }).success).toBe(
      true
    )
  })
})

describe('environmentInputSchema', () => {
  it('acepta un entorno SaaS completo y normaliza las URL', () => {
    const parsed = environmentInputSchema.parse(
      saasEnvironment({ classicApiUrl: 'https://abc12345.live.dynatrace.com/', name: ' Prod ' })
    )
    expect(parsed).toMatchObject({
      name: 'Prod',
      classicApiUrl: 'https://abc12345.live.dynatrace.com'
    })
  })

  it('acepta las URL a null', () => {
    const result = environmentInputSchema.safeParse(
      saasEnvironment({ classicApiUrl: null, platformUrl: null, ssoUrl: null })
    )
    expect(result.success).toBe(true)
  })

  it.each([
    ['clientId que no es uuid', { clientId: 'cliente-1' }],
    ['nombre vacío', { name: '' }],
    ['tipo desconocido', { type: 'staging' }],
    ['despliegue desconocido', { deployment: 'cloud' }],
    ['nivel de certificados desconocido', { certificateLevel: 'off' }],
    ['URL clásica http', { classicApiUrl: 'http://abc12345.live.dynatrace.com' }],
    ['URL de plataforma http', { platformUrl: 'http://abc12345.apps.dynatrace.com' }],
    ['URL de SSO con credenciales', { ssoUrl: 'https://u:p@sso.dynatrace.com' }],
    ['readOnly que no es booleano', { readOnly: 'no' }],
    ['tags que no es una lista', { tags: 'core' }]
  ])('rechaza %s', (_case, overrides) => {
    expect(environmentInputSchema.safeParse(saasEnvironment(overrides)).success).toBe(false)
  })

  describe('Managed (sin plataforma)', () => {
    const managed = {
      deployment: 'managed',
      classicApiUrl: 'https://dt.ejemplo.local/e/abc-123',
      platformUrl: null,
      oauthClientId: null,
      oauthScopes: [],
      accountUuid: null
    }

    it('acepta un entorno Managed sin datos de plataforma', () => {
      expect(environmentInputSchema.safeParse(saasEnvironment(managed)).success).toBe(true)
    })

    it.each([
      ['URL de plataforma', { platformUrl: 'https://abc12345.apps.dynatrace.com' }],
      ['client id de OAuth', { oauthClientId: 'dt0s02.EJEMPLO' }],
      ['scopes OAuth', { oauthScopes: ['storage:logs:read'] }],
      ['UUID de cuenta', { accountUuid: '7a1b2c3d-0000-4000-8000-000000000000' }]
    ])('rechaza un entorno Managed con %s', (_case, overrides) => {
      expect(
        environmentInputSchema.safeParse(saasEnvironment({ ...managed, ...overrides })).success
      ).toBe(false)
    })
  })
})

describe('configFileSchema', () => {
  const environment = saasEnvironment()
  delete environment['clientId']
  const file = {
    format: 'vigia-config',
    version: 1,
    exportedAt: '2026-10-03T10:00:00.000Z',
    clients: [{ name: 'Cliente A', color: '#112233', environments: [environment] }]
  }

  it('acepta un fichero válido', () => {
    expect(configFileSchema.safeParse(file).success).toBe(true)
  })

  it.each([
    ['otro formato', { format: 'otra-app' }],
    ['versión 2', { version: 2 }],
    ['fecha que no es ISO', { exportedAt: 'ayer' }],
    ['clients que no es una lista', { clients: {} }]
  ])('rechaza un fichero con %s', (_case, overrides) => {
    expect(configFileSchema.safeParse({ ...file, ...overrides }).success).toBe(false)
  })

  it('valida los entornos de forma laxa: una URL http se acepta aquí y se rechaza al importar', () => {
    const lax = {
      ...file,
      clients: [
        {
          name: 'Cliente A',
          color: '#112233',
          environments: [{ ...environment, classicApiUrl: 'http://abc12345.live.dynatrace.com' }]
        }
      ]
    }
    expect(configFileSchema.safeParse(lax).success).toBe(true)
  })

  it('rechaza un entorno sin nombre de texto', () => {
    const bad = {
      ...file,
      clients: [{ name: 'Cliente A', color: '#112233', environments: [{ type: 'production' }] }]
    }
    expect(configFileSchema.safeParse(bad).success).toBe(false)
  })

  it('rechaza un cliente con color inválido', () => {
    const bad = { ...file, clients: [{ name: 'Cliente A', color: 'red', environments: [] }] }
    expect(configFileSchema.safeParse(bad).success).toBe(false)
  })
})
