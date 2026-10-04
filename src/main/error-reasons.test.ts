import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { errorReasonKeys, REASON_MAX_PARAMS, REASON_PARAM_MAX_LENGTH } from '@shared/error-reasons'
import { DtError } from './dynatrace/errors'
import { testConnection } from './dynatrace/connection-test'
import { DomainError, wireReason } from './errors'
import { createIpcHandler, type IpcHandlerDeps } from './ipc/handler'

/**
 * i18n (b): los errores de main viajan con un motivo (`reason`) que el renderer
 * traduce. Aquí: la validación en la frontera IPC, que los secretos no se
 * cuelen en los parámetros, que ningún error nuevo se quede sin motivo y que
 * cada motivo tenga texto en los dos idiomas.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const CLASSIC_TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOCLASICO'.padEnd(64, 'X')}`

/** Un error con el `reason` que se quiera, saltándose cleanReason (como si llegara mal formado). */
function withRawReason<E extends Error>(error: E, reason: unknown): E {
  Object.defineProperty(error, 'reason', { value: reason, configurable: true })
  return error
}

const INVALID_REASONS: [string, unknown][] = [
  ['una clave desconocida', { key: 'noExiste' }],
  [
    `${REASON_MAX_PARAMS + 1} parámetros`,
    {
      key: 'network',
      params: Object.fromEntries(
        Array.from({ length: REASON_MAX_PARAMS + 1 }, (_, i) => [`p${i}`, 'x'])
      )
    }
  ],
  [
    `un parámetro de ${REASON_PARAM_MAX_LENGTH + 1} caracteres`,
    { key: 'network', params: { detail: 'x'.repeat(REASON_PARAM_MAX_LENGTH + 1) } }
  ],
  ['un parámetro que no es texto ni número', { key: 'network', params: { detail: { a: 1 } } }],
  ['algo que no es un objeto', 'network']
]

function deps(): IpcHandlerDeps {
  return { isTrustedSender: () => true, logger: { warn: vi.fn(), error: vi.fn() } }
}

/** Un canal cualquiera cuya implementación lanza `error`. */
async function callThrowing(error: Error, handlerDeps = deps()): Promise<unknown> {
  const handler = createIpcHandler(
    'app:ping',
    () => {
      throw error
    },
    handlerDeps
  )
  return handler(TRUSTED, { message: 'hola' })
}

describe('1. Validación del motivo en la frontera IPC', () => {
  it('un motivo válido llega tal cual, con code y message', async () => {
    const result = await callThrowing(
      new DtError('TIMEOUT', 'Sin respuesta en 30 s.', undefined, {
        key: 'timeout',
        params: { seconds: 30 }
      })
    )
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'TIMEOUT',
        message: 'Sin respuesta en 30 s.',
        reason: { key: 'timeout', params: { seconds: 30 } }
      }
    })
  })

  it('sin motivo, el error no lleva la clave reason', async () => {
    const result = (await callThrowing(new DomainError('NOT_FOUND', 'No existe.'))) as {
      error: Record<string, unknown>
    }
    expect(Object.keys(result.error).sort()).toEqual(['code', 'message'])
  })

  it.each(INVALID_REASONS)(
    'DtError con %s → llega con code y message, sin reason, y se avisa en el log',
    async (_case, reason) => {
      const handlerDeps = deps()
      const result = (await callThrowing(
        withRawReason(new DtError('NETWORK', 'Error de red.'), reason),
        handlerDeps
      )) as { ok: boolean; error: Record<string, unknown> }
      expect(result).toEqual({ ok: false, error: { code: 'NETWORK', message: 'Error de red.' } })
      expect(handlerDeps.logger.warn).toHaveBeenCalled()
      // El aviso no lleva los parámetros (pueden traer texto de fuera).
      expect(JSON.stringify(vi.mocked(handlerDeps.logger.warn).mock.calls)).not.toContain('xxxxx')
    }
  )

  it.each(INVALID_REASONS)('DomainError con %s → igual', async (_case, reason) => {
    const handlerDeps = deps()
    const result = await callThrowing(
      withRawReason(new DomainError('CONFLICT', 'Ya existe.'), reason),
      handlerDeps
    )
    expect(result).toEqual({ ok: false, error: { code: 'CONFLICT', message: 'Ya existe.' } })
    expect(handlerDeps.logger.warn).toHaveBeenCalled()
  })

  it('wireReason: válido → el motivo; inválido → undefined y un aviso con la clave', () => {
    const warn = vi.fn()
    expect(wireReason({ key: 'rateLimited' }, warn)).toEqual({ key: 'rateLimited' })
    expect(wireReason(undefined, warn)).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
    expect(wireReason({ key: 'noExiste', params: { detail: 'SECRETO' } }, warn)).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain('noExiste')
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('SECRETO')
  })

  describe('en connection-test (deps.warn)', () => {
    function run(
      error: Error,
      warn?: (message: string) => void
    ): ReturnType<typeof testConnection> {
      return testConnection('env-1', {
        client: {
          dtRequest: vi.fn(async () => {
            throw error
          }),
          paginate: vi.fn()
        },
        oauth: { getToken: vi.fn(), invalidate: vi.fn(), expiresAt: vi.fn(() => null) },
        getEnvironment: () => ({
          id: 'env-1',
          classicApiUrl: 'https://abc12345.live.dynatrace.com',
          platformUrl: null,
          deployment: 'managed'
        }),
        secretsStatus: () => ({
          classicToken: true,
          oauthClientSecret: false,
          platformToken: false
        }),
        readSecret: () => CLASSIC_TOKEN,
        ...(warn === undefined ? {} : { warn })
      } as unknown as Parameters<typeof testConnection>[1])
    }

    it('un motivo válido llega al mecanismo', async () => {
      const report = await run(
        new DtError('TLS_UNTRUSTED', 'No es de confianza.', undefined, {
          key: 'tlsUntrusted',
          params: { host: 'abc12345.live.dynatrace.com' }
        })
      )
      expect(report.mechanisms[0]?.error).toEqual({
        code: 'TLS_UNTRUSTED',
        message: 'No es de confianza.',
        reason: { key: 'tlsUntrusted', params: { host: 'abc12345.live.dynatrace.com' } }
      })
    })

    it.each(INVALID_REASONS)(
      'con %s → el mecanismo lleva code y message sin reason, y deps.warn avisa',
      async (_case, reason) => {
        const warn = vi.fn()
        const report = await run(
          withRawReason(new DtError('NETWORK', 'Error de red.'), reason),
          warn
        )
        expect(report.mechanisms[0]?.error).toEqual({ code: 'NETWORK', message: 'Error de red.' })
        expect(warn).toHaveBeenCalledOnce()
      }
    )

    it('sin deps.warn, un motivo inválido no rompe la prueba', async () => {
      const report = await run(withRawReason(new DtError('NETWORK', 'Error de red.'), 'malo'))
      expect(report.mechanisms[0]?.error).toEqual({ code: 'NETWORK', message: 'Error de red.' })
    })

    it('un error inesperado → connectionUnexpected', async () => {
      const report = await run(new Error('algo raro'))
      expect(report.mechanisms[0]?.error).toMatchObject({
        reason: { key: 'connectionUnexpected' }
      })
    })
  })
})

describe('2. Ningún secreto en los parámetros del motivo', () => {
  const SECRET_PARAMS = {
    token: `antes ${CLASSIC_TOKEN} después`,
    header: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.SECRETOBEARER.firma',
    apiToken: 'Api-Token SECRETOAPITOKEN123'
  }
  const leaks = (text: string): string[] =>
    ['SECRETOCLASICO', 'SECRETOBEARER', 'SECRETOAPITOKEN'].filter((s) => text.includes(s))

  it('DtError enmascara los parámetros de texto', () => {
    const error = new DtError('NETWORK', 'x', undefined, { key: 'network', params: SECRET_PARAMS })
    expect(leaks(JSON.stringify(error.reason))).toEqual([])
    expect(error.reason?.params?.['token']).toContain('dt0c01.PUBLICAPRUEBA0000000000A')
  })

  it('DomainError enmascara los parámetros de texto', () => {
    const error = new DomainError('CONFLICT', 'x', {
      key: 'clientNameTaken',
      params: SECRET_PARAMS
    })
    expect(leaks(JSON.stringify(error.reason))).toEqual([])
  })

  it('los parámetros largos se recortan a REASON_PARAM_MAX_LENGTH y los números no cambian', () => {
    const error = new DtError('NETWORK', 'x', undefined, {
      key: 'timeout',
      params: { detail: 'y'.repeat(1000), seconds: 30 }
    })
    expect(String(error.reason?.params?.['detail'])).toHaveLength(REASON_PARAM_MAX_LENGTH)
    expect(error.reason?.params?.['seconds']).toBe(30)
  })

  it('enmascarar ANTES de recortar: un token cortado a medias tampoco se filtra', () => {
    const padding = 'z'.repeat(REASON_PARAM_MAX_LENGTH - 40)
    const error = new DtError('NETWORK', 'x', undefined, {
      key: 'network',
      params: { detail: `${padding}${CLASSIC_TOKEN}` }
    })
    expect(String(error.reason?.params?.['detail'])).not.toContain('SECRETO')
  })

  it('y por el handler tampoco salen', async () => {
    const result = await callThrowing(
      new DtError('NETWORK', 'Error de red.', undefined, { key: 'network', params: SECRET_PARAMS })
    )
    expect(leaks(JSON.stringify(result))).toEqual([])
  })
})

/** Ficheros .ts de src/main, sin tests. */
function mainSources(dir = join('src', 'main')): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return mainSources(path)
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
  })
}

/** Argumentos de nivel superior de la llamada que empieza en `open` (el índice del "("). */
function callArguments(source: string, open: number): string[] {
  const args: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (let i = open + 1; i < source.length; i++) {
    const ch = source[i] ?? ''
    if (quote !== null) {
      current += ch
      if (ch === '\\') {
        current += source[++i] ?? ''
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      current += ch
    } else if ('([{'.includes(ch)) {
      depth++
      current += ch
    } else if (')]}'.includes(ch)) {
      if (depth === 0) {
        if (current.trim() !== '') args.push(current.trim())
        return args
      }
      depth--
      current += ch
    } else if (ch === ',' && depth === 0) {
      args.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  throw new Error('llamada sin cerrar')
}

describe('3. Ningún DtError ni DomainError nuevo se queda sin motivo', () => {
  /**
   * Lista blanca: errores con el texto de Dynatrace, que el renderer muestra tal
   * cual (no se traducen). Se identifican por fichero y por sus argumentos.
   */
  const ALLOWED: { file: string; args: string[] }[] = [
    {
      file: 'src/main/dynatrace/client.ts',
      args: ["'UNAUTHORIZED'", 'await readBody(readErrorMessage(response))', '401']
    },
    { file: 'src/main/dynatrace/client.ts', args: ['code', 'message', 'response.status'] }
  ]

  const calls = mainSources().flatMap((path) => {
    const source = readFileSync(path, 'utf8')
    const file = relative('.', path).split('\\').join('/')
    const found: { file: string; line: number; kind: string; args: string[] }[] = []
    for (const kind of ['DtError', 'DomainError']) {
      const pattern = new RegExp(`new ${kind}\\(`, 'g')
      for (const match of source.matchAll(pattern)) {
        const open = (match.index ?? 0) + match[0].length - 1
        found.push({
          file,
          line: source.slice(0, open).split('\n').length,
          kind,
          args: callArguments(source, open)
        })
      }
    }
    return found
  })

  it('el analizador de argumentos separa bien (comas en cadenas, plantillas y objetos)', () => {
    const sample =
      "new DtError('A, b', `x ${y(1, 2)}`, 400, { key: 'k', params: { a: 1, b: ')' } })"
    expect(callArguments(sample, sample.indexOf('('))).toEqual([
      "'A, b'",
      '`x ${y(1, 2)}`',
      '400',
      "{ key: 'k', params: { a: 1, b: ')' } }"
    ])
    const noReason = "new DomainError('NOT_FOUND', 'No existe.')"
    expect(callArguments(noReason, noReason.indexOf('('))).toHaveLength(2)
  })

  it('el escaneo encuentra las construcciones (si no, el test no prueba nada)', () => {
    expect(calls.length).toBeGreaterThan(30)
    expect(calls.some((c) => c.kind === 'DomainError')).toBe(true)
    expect(calls.some((c) => c.kind === 'DtError')).toBe(true)
  })

  it('cada una lleva motivo (4.º argumento de DtError, 3.º de DomainError), salvo la lista blanca', () => {
    const missing = calls.filter((call) => {
      const position = call.kind === 'DtError' ? 3 : 2
      const reason = call.args[position]
      if (reason !== undefined && reason !== 'undefined') return false
      return !ALLOWED.some(
        (allowed) =>
          allowed.file === call.file && JSON.stringify(allowed.args) === JSON.stringify(call.args)
      )
    })
    expect(
      missing.map((c) => `${c.file}:${c.line} new ${c.kind}(${c.args.join(', ')})`),
      'sin motivo: añade un reason o, si es texto de Dynatrace, a la lista blanca'
    ).toEqual([])
  })

  it('la lista blanca sigue existiendo (si cambia el código, se revisa)', () => {
    for (const allowed of ALLOWED) {
      expect(
        calls.some(
          (call) =>
            call.file === allowed.file && JSON.stringify(call.args) === JSON.stringify(allowed.args)
        ),
        allowed.args.join(', ')
      ).toBe(true)
    }
  })

  it('un motivo literal usa una clave de errorReasonKeys', () => {
    const literalKeys = calls.flatMap((call) => {
      const reason = call.args[call.kind === 'DtError' ? 3 : 2] ?? ''
      const key = /key:\s*'([^']+)'/.exec(reason)?.[1]
      return key === undefined ? [] : [{ key, where: `${call.file}:${call.line}` }]
    })
    expect(literalKeys.length).toBeGreaterThan(20)
    const known = new Set<string>(errorReasonKeys)
    expect(literalKeys.filter((k) => !known.has(k.key))).toEqual([])
  })
})

describe('4. Cada motivo tiene texto en es y en, con los mismos parámetros', () => {
  const load = (locale: string): Record<string, unknown> =>
    JSON.parse(
      readFileSync(join('src', 'renderer', 'src', 'locales', locale, 'common.json'), 'utf8')
    ) as Record<string, unknown>
  const reasons = {
    es: (load('es')['errorReasons'] ?? {}) as Record<string, unknown>,
    en: (load('en')['errorReasons'] ?? {}) as Record<string, unknown>
  }
  const placeholders = (text: unknown): string[] =>
    [...String(text).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1] ?? '').sort()

  it.each(errorReasonKeys)('%s', (key) => {
    for (const locale of ['es', 'en'] as const) {
      const text = reasons[locale][key]
      expect(typeof text, `${locale}: errorReasons.${key}`).toBe('string')
      expect(String(text).trim(), `${locale}: errorReasons.${key}`).not.toBe('')
    }
    expect(placeholders(reasons.en[key]), `placeholders de ${key}`).toEqual(
      placeholders(reasons.es[key])
    )
  })

  it('no sobran claves en los locales', () => {
    const known = [...errorReasonKeys].sort()
    expect(Object.keys(reasons.es).sort()).toEqual(known)
    expect(Object.keys(reasons.en).sort()).toEqual(known)
  })
})
