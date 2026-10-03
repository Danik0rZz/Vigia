import { describe, expect, it } from 'vitest'
import { asciiUserAgent } from './user-agent'

describe('User-Agent', () => {
  const electronDefault =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Vigía/0.1.0 Chrome/140.0.0.0 Electron/44.5.1 Safari/537.36'

  it('sustituye el nombre con tilde por el identificador técnico', () => {
    const userAgent = asciiUserAgent(electronDefault, 'Vigía', '0.1.0')

    expect(userAgent).toContain(' vigia/0.1.0 ')
    expect(userAgent).toContain('Electron/44.5.1')
  })

  it('solo deja caracteres válidos en una cabecera HTTP', () => {
    for (const name of ['Vigía', 'Otro nombre ñ']) {
      expect(asciiUserAgent(electronDefault, name, '0.1.0')).toMatch(/^[\x20-\x7E]+$/)
    }
  })
})
