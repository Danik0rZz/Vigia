import { describe, expect, it } from 'vitest'
import type { EnvironmentView } from '@shared/tenants'
import {
  environmentFormSchema,
  environmentToForm,
  formToEnvironmentInput,
  NEW_ENVIRONMENT,
  normalizedClassicUrl,
  type EnvironmentFormValues
} from './forms'

/**
 * AUD-06: una URL con "?" tiene su propio error en el formulario
 * (errors.urlQuery), distinto del de URL no válida (errors.httpsUrl). Sin DOM.
 */

const valid = {
  ...NEW_ENVIRONMENT,
  name: 'Producción',
  classicApiUrl: 'https://abc12345.live.dynatrace.com'
}

function issuesFor(field: 'classicApiUrl' | 'platformUrl' | 'ssoUrl', value: string): string[] {
  const result = environmentFormSchema.safeParse({ ...valid, [field]: value })
  if (result.success) return []
  return result.error.issues
    .filter((issue) => issue.path[0] === field)
    .map((issue) => issue.message)
}

describe('environmentFormSchema: URLs', () => {
  it('un formulario válido pasa, y las URLs vacías son opcionales', () => {
    expect(environmentFormSchema.safeParse(valid).success).toBe(true)
    expect(issuesFor('platformUrl', '')).toEqual([])
    expect(issuesFor('ssoUrl', '   ')).toEqual([])
  })

  it.each(['classicApiUrl', 'platformUrl', 'ssoUrl'] as const)(
    '%s con "?" → errors.urlQuery',
    (field) => {
      for (const value of [
        'https://abc12345.live.dynatrace.com?x=1',
        'https://abc12345.live.dynatrace.com/?',
        `https://abc12345.live.dynatrace.com/api/v2?Api-Token=dt0c01.FALSO.${'Q'.repeat(20)}`,
        'https://abc12345.live.dynatrace.com/api/v2?x=1'
      ]) {
        expect(issuesFor(field, value), `${field} ${value.slice(0, 50)}`).toEqual([
          'errors.urlQuery'
        ])
      }
    }
  )

  it.each(['classicApiUrl', 'platformUrl', 'ssoUrl'] as const)(
    '%s inválida sin "?" → errors.httpsUrl',
    (field) => {
      for (const value of [
        'http://abc12345.live.dynatrace.com',
        'no es una url',
        'https://u:p@abc12345.live.dynatrace.com'
      ]) {
        expect(issuesFor(field, value), `${field} ${value}`).toEqual(['errors.httpsUrl'])
      }
    }
  )

  it('normalizedClassicUrl quita /api/v2 de una URL válida y deja tal cual una con "?"', () => {
    expect(normalizedClassicUrl('https://abc12345.live.dynatrace.com/api/v2')).toBe(
      'https://abc12345.live.dynatrace.com'
    )
    expect(normalizedClassicUrl('https://abc12345.live.dynatrace.com/api/v2?x=1')).toBe(
      'https://abc12345.live.dynatrace.com/api/v2?x=1'
    )
  })
})

// AUD-20: conversión entre el formulario y la entrada del canal IPC.
const LF = String.fromCharCode(10)
const CRLF = String.fromCharCode(13) + LF
const CLIENT = '3f0c2b1a-9d8e-4c7b-a6f5-0e1d2c3b4a59'

const form = (overrides: Partial<EnvironmentFormValues> = {}): EnvironmentFormValues => ({
  ...NEW_ENVIRONMENT,
  name: 'Producción',
  classicApiUrl: 'https://abc12345.live.dynatrace.com',
  ...overrides
})

describe('formToEnvironmentInput', () => {
  it('etiquetas: separadas por coma, recortadas y sin vacías', () => {
    const input = formToEnvironmentInput(form({ tags: ' core ,pagos,, ,  carrito  ' }), CLIENT)
    expect(input.tags).toEqual(['core', 'pagos', 'carrito'])
  })

  it('patrones de captura: uno por línea (LF o CRLF), recortados y sin líneas vacías', () => {
    const patterns = ['  https://a/*  ', '', 'https://b/*', '   ', 'https://c/*'].join(LF)
    expect(
      formToEnvironmentInput(form({ captureUrlPatterns: patterns }), CLIENT).captureUrlPatterns
    ).toEqual(['https://a/*', 'https://b/*', 'https://c/*'])
    const windows = ['https://a/*', 'https://b/*'].join(CRLF)
    expect(
      formToEnvironmentInput(form({ captureUrlPatterns: windows }), CLIENT).captureUrlPatterns
    ).toEqual(['https://a/*', 'https://b/*'])
  })

  it('una coma dentro de un patrón no lo parte (solo el salto de línea separa)', () => {
    expect(
      formToEnvironmentInput(form({ captureUrlPatterns: 'https://a/x,y' }), CLIENT)
        .captureUrlPatterns
    ).toEqual(['https://a/x,y'])
  })

  it('scopes de OAuth: separados por espacios (uno o varios, también saltos de línea)', () => {
    const scopes = `  storage:logs:read   storage:buckets:read${LF}environment-api:problems:read `
    expect(formToEnvironmentInput(form({ oauthScopes: scopes }), CLIENT).oauthScopes).toEqual([
      'storage:logs:read',
      'storage:buckets:read',
      'environment-api:problems:read'
    ])
  })

  it('URLs y textos vacíos (o solo espacios) → null; con valor, recortados', () => {
    const input = formToEnvironmentInput(
      form({
        classicApiUrl: '   ',
        platformUrl: '',
        ssoUrl: '  ',
        oauthClientId: ' ',
        accountUuid: ''
      }),
      CLIENT
    )
    expect(input).toMatchObject({
      classicApiUrl: null,
      platformUrl: null,
      ssoUrl: null,
      oauthClientId: null,
      accountUuid: null,
      oauthScopes: []
    })
    expect(
      formToEnvironmentInput(form({ name: '  Producción  ', oauthClientId: ' dt0s02.X ' }), CLIENT)
    ).toMatchObject({ name: 'Producción', oauthClientId: 'dt0s02.X' })
  })

  it('la URL clásica se guarda sin /api/v2', () => {
    expect(
      formToEnvironmentInput(
        form({ classicApiUrl: 'https://abc12345.live.dynatrace.com/api/v2' }),
        CLIENT
      ).classicApiUrl
    ).toBe('https://abc12345.live.dynatrace.com')
  })

  it('en Managed se vacía la plataforma (URL, client ID, scopes y account UUID); el SSO no', () => {
    const input = formToEnvironmentInput(
      form({
        deployment: 'managed',
        classicApiUrl: 'https://dt.ejemplo.local/e/abc-123',
        platformUrl: 'https://abc12345.apps.dynatrace.com',
        ssoUrl: 'https://sso.ejemplo.local/token',
        oauthClientId: 'dt0s02.X',
        oauthScopes: 'storage:logs:read',
        accountUuid: '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b'
      }),
      CLIENT
    )
    expect(input).toMatchObject({
      deployment: 'managed',
      classicApiUrl: 'https://dt.ejemplo.local/e/abc-123',
      platformUrl: null,
      oauthClientId: null,
      oauthScopes: [],
      accountUuid: null,
      ssoUrl: 'https://sso.ejemplo.local/token'
    })
  })

  it.each([
    ['system', false],
    ['pinned', true],
    ['ignore', false]
  ] as const)('certificateLevel %s y readOnly %s pasan tal cual', (level, readOnly) => {
    expect(
      formToEnvironmentInput(form({ certificateLevel: level, readOnly }), CLIENT)
    ).toMatchObject({ certificateLevel: level, readOnly, clientId: CLIENT })
  })
})

describe('environmentToForm', () => {
  const view: EnvironmentView = {
    id: '7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2910',
    clientId: CLIENT,
    name: 'Producción',
    type: 'production',
    deployment: 'saas',
    classicApiUrl: 'https://abc12345.live.dynatrace.com',
    platformUrl: 'https://abc12345.apps.dynatrace.com',
    ssoUrl: null,
    oauthClientId: 'dt0s02.EJEMPLO',
    oauthScopes: ['storage:logs:read', 'storage:buckets:read'],
    accountUuid: null,
    certificateLevel: 'pinned',
    captureUrlPatterns: ['https://abc12345.apps.dynatrace.com/platform/*', 'https://x/*'],
    tags: ['core', 'pagos'],
    readOnly: true,
    secrets: { classicToken: true, oauthClientSecret: false, platformToken: false },
    unreadableSecrets: []
  }

  it('null → vacío; listas unidas con su separador', () => {
    expect(environmentToForm(view)).toEqual({
      name: 'Producción',
      type: 'production',
      deployment: 'saas',
      classicApiUrl: 'https://abc12345.live.dynatrace.com',
      platformUrl: 'https://abc12345.apps.dynatrace.com',
      ssoUrl: '',
      oauthClientId: 'dt0s02.EJEMPLO',
      oauthScopes: 'storage:logs:read storage:buckets:read',
      accountUuid: '',
      certificateLevel: 'pinned',
      tags: 'core, pagos',
      captureUrlPatterns: `https://abc12345.apps.dynatrace.com/platform/*${LF}https://x/*`,
      readOnly: true
    })
  })

  it('no lleva nada de los secretos', () => {
    expect(JSON.stringify(environmentToForm(view))).not.toContain('secrets')
  })

  it('ida y vuelta: environmentToForm → formToEnvironmentInput deja la misma entrada', () => {
    const { id: _id, secrets: _secrets, unreadableSecrets: _unreadable, ...input } = view
    void [_id, _secrets, _unreadable]
    expect(formToEnvironmentInput(environmentToForm(view), CLIENT)).toEqual(input)
  })

  it('ida y vuelta también en Managed y sin listas', () => {
    const managed: EnvironmentView = {
      ...view,
      deployment: 'managed',
      classicApiUrl: 'https://dt.ejemplo.local/e/abc-123',
      platformUrl: null,
      oauthClientId: null,
      oauthScopes: [],
      ssoUrl: 'https://sso.ejemplo.local/token',
      tags: [],
      captureUrlPatterns: [],
      readOnly: false,
      certificateLevel: 'ignore'
    }
    const { id: _id, secrets: _secrets, unreadableSecrets: _unreadable, ...input } = managed
    void [_id, _secrets, _unreadable]
    expect(formToEnvironmentInput(environmentToForm(managed), CLIENT)).toEqual(input)
  })

  it('un formulario que sale de una vista es válido para environmentFormSchema', () => {
    expect(environmentFormSchema.safeParse(environmentToForm(view)).success).toBe(true)
  })
})
