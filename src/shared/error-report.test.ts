import { describe, expect, it } from 'vitest'
import {
  ERROR_REPORT_LIMITS,
  createErrorThrottle,
  isChunkLoadError,
  maskErrorDetails
} from './error-report'

/**
 * v0.10.1: informe de errores de la interfaz. Detección del fallo de carga de
 * un chunk, enmascarado de lo que se copia o se registra (tokens, rutas de
 * usuario y credenciales en la query) y límite de registros por minuto.
 * Datos inventados.
 */

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: app://vigia/assets/Page-abc123.js',
    'error loading dynamically imported module: app://vigia/assets/x.js',
    'Importing a module script failed.',
    'Loading chunk 42 failed.',
    'Loading CSS chunk 7 failed.',
    'FAILED TO FETCH DYNAMICALLY IMPORTED MODULE'
  ])('el mensaje «%s» → true (Error, string y objeto con message)', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true)
    expect(isChunkLoadError(message)).toBe(true)
    expect(isChunkLoadError({ message })).toBe(true)
  })

  it('name ChunkLoadError → true aunque el mensaje no diga nada', () => {
    const error = new Error('otra cosa')
    error.name = 'ChunkLoadError'
    expect(isChunkLoadError(error)).toBe(true)
  })

  it.each([
    ['un error normal', new Error('Cannot read properties of undefined')],
    ['TypeError de red', new TypeError('Failed to fetch')],
    ['chunk sin "failed"', new Error('Loading chunk 42')],
    ['null', null],
    ['undefined', undefined],
    ['número', 42],
    ['objeto sin message', { code: 'X' }],
    ['message no texto', { message: 42 }]
  ])('%s → false', (_label, error) => {
    expect(isChunkLoadError(error)).toBe(false)
  })
})

describe('maskErrorDetails', () => {
  it('tokens de Dynatrace y cabeceras (maskSecrets)', () => {
    const text = `token dt0c01.PUBLICA0000000000000000A.SECRETOSECRETOSECRETO y Api-Token abc.def`
    const masked = maskErrorDetails(text)
    expect(masked).not.toContain('SECRETOSECRETOSECRETO')
    expect(masked).toContain('dt0c01.PUBLICA0000000000000000A.***')
    expect(masked).not.toContain('abc.def')
  })

  it.each([
    [
      'C:\\Users\\dani\\AppData\\Roaming\\vigia\\logs\\main.log',
      'C:\\Users\\<usuario>\\AppData\\Roaming\\vigia\\logs\\main.log'
    ],
    ['D:/Users/Pepe.Garcia/app/x.js', 'D:/Users/<usuario>/app/x.js'],
    ['c:\\users\\otra\\x', 'c:\\users\\<usuario>\\x'],
    ['/home/dani/.config/vigia/x', '/home/<usuario>/.config/vigia/x'],
    ['/Users/dani/Library/x', '/Users/<usuario>/Library/x']
  ])('ruta de usuario %s → %s', (input, expected) => {
    expect(maskErrorDetails(input)).toBe(expected)
  })

  it('%APPDATA% literal se deja; expandido, cae por la ruta de usuario', () => {
    expect(maskErrorDetails('%APPDATA%\\vigia')).toBe('%APPDATA%\\vigia')
    expect(maskErrorDetails('en C:\\Users\\maria\\AppData\\Roaming\\vigia')).toBe(
      'en C:\\Users\\<usuario>\\AppData\\Roaming\\vigia'
    )
  })

  it('varias rutas en un stack, todas', () => {
    const stack = [
      'Error: x',
      '    at f (C:\\Users\\dani\\a.js:1:1)',
      '    at g (C:\\Users\\dani\\b.js:2:2)'
    ].join('\n')
    const masked = maskErrorDetails(stack)
    expect(masked).not.toMatch(/dani/)
    expect(masked.match(/<usuario>/g)).toHaveLength(2)
  })

  it.each([
    'api-token',
    'token',
    'access_token',
    'refresh_token',
    'password',
    'secret',
    'client_secret',
    'code',
    'key',
    'API-TOKEN',
    'Password'
  ])('query: el valor de %s → ***', (param) => {
    const url = `https://ejemplo.invalid/api?a=1&${param}=VALORSECRETO&b=2`
    const masked = maskErrorDetails(url)
    expect(masked).not.toContain('VALORSECRETO')
    expect(masked).toContain(`${param}=***`)
    // El resto de la query se conserva.
    expect(masked).toContain('a=1')
    expect(masked).toContain('b=2')
  })

  it('query: también como primer parámetro (?x=) y sin tocar parámetros que solo se parecen', () => {
    expect(maskErrorDetails('https://x.invalid/?token=ABC123&pageSize=10')).toBe(
      'https://x.invalid/?token=***&pageSize=10'
    )
    expect(maskErrorDetails('https://x.invalid/?tokenId=PUBLICO&monkey=1')).toBe(
      'https://x.invalid/?tokenId=PUBLICO&monkey=1'
    )
  })

  it('un texto sin nada sensible no cambia; es idempotente', () => {
    const plain = 'TypeError: algo falló en /problems/p-1'
    expect(maskErrorDetails(plain)).toBe(plain)
    const sensitive = 'C:\\Users\\dani\\x?token=abc'
    expect(maskErrorDetails(maskErrorDetails(sensitive))).toBe(maskErrorDetails(sensitive))
  })
})

describe('ERROR_REPORT_LIMITS', () => {
  it('los límites del contrato', () => {
    expect(ERROR_REPORT_LIMITS).toEqual({ message: 2000, stack: 8000, route: 500, version: 50 })
  })
})

describe('createErrorThrottle', () => {
  function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
    let time = start
    return { now: () => time, advance: (ms) => (time += ms) }
  }

  it('la misma pareja (mensaje, ruta) solo una vez por ventana; otra ruta u otro mensaje, sí', () => {
    const c = clock()
    const throttle = createErrorThrottle({ now: c.now })
    expect(throttle.allow('boom', '/a')).toBe(true)
    expect(throttle.allow('boom', '/a')).toBe(false)
    expect(throttle.allow('boom', '/b')).toBe(true)
    expect(throttle.allow('otro', '/a')).toBe(true)
    c.advance(59_999)
    expect(throttle.allow('boom', '/a')).toBe(false)
    c.advance(2)
    expect(throttle.allow('boom', '/a')).toBe(true)
  })

  it('como mucho 10 por minuto en total (errores distintos en bucle)', () => {
    const c = clock()
    const throttle = createErrorThrottle({ now: c.now })
    const allowed = Array.from({ length: 50 }, (_, i) => throttle.allow(`error ${i}`, '/x')).filter(
      Boolean
    )
    expect(allowed).toHaveLength(10)
  })

  it('ventana deslizante: los huecos se liberan a medida que salen los antiguos', () => {
    const c = clock()
    const throttle = createErrorThrottle({ now: c.now })
    for (let i = 0; i < 10; i += 1) {
      expect(throttle.allow(`e${i}`, '/')).toBe(true)
      c.advance(1000)
    }
    // 10 en los últimos 10 s: el 11.º no.
    expect(throttle.allow('e10', '/')).toBe(false)
    // A los 60 s del primero, sale ese y entra uno.
    c.advance(50_001)
    expect(throttle.allow('e11', '/')).toBe(true)
    expect(throttle.allow('e12', '/')).toBe(false)
  })

  it('max y windowMs propios', () => {
    const c = clock()
    const throttle = createErrorThrottle({ windowMs: 1000, max: 2, now: c.now })
    expect(throttle.allow('a', '/')).toBe(true)
    expect(throttle.allow('b', '/')).toBe(true)
    expect(throttle.allow('c', '/')).toBe(false)
    c.advance(1001)
    expect(throttle.allow('c', '/')).toBe(true)
  })

  it('un rechazado no cuenta para el límite', () => {
    const c = clock()
    const throttle = createErrorThrottle({ max: 2, now: c.now })
    expect(throttle.allow('a', '/')).toBe(true)
    for (let i = 0; i < 20; i += 1) expect(throttle.allow('a', '/')).toBe(false)
    expect(throttle.allow('b', '/')).toBe(true)
  })
})
