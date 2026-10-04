import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl } from './external-url'

/**
 * v0.9.0, app:openExternal: solo se abren fuera URLs http(s) con host y sin
 * credenciales. Todo lo demás se rechaza antes de llegar a shell.openExternal.
 */

describe('isSafeExternalUrl', () => {
  it.each([
    'https://docs.dynatrace.com/docs',
    'https://abc12345.live.dynatrace.com/#problems/problemdetails;pid=-1234_5678',
    'http://dt.ejemplo.local:8080/e/abc/ui',
    'HTTPS://EXAMPLE.COM/'
  ])('acepta %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(true)
  })

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['javascript: con mayúsculas y espacios', ' JavaScript:alert(1)'],
    ['file:', 'file:///C:/Windows/System32/calc.exe'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['mailto:', 'mailto:alguien@example.com'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['ftp:', 'ftp://example.com/x'],
    ['un esquema propio', 'vigia://abrir'],
    ['app:// de la propia app', 'app://vigia/index.html'],
    ['http sin host', 'http:///ruta'],
    ['https sin host', 'https://'],
    ['usuario y contraseña', 'https://usuario:clave@example.com/'],
    ['solo usuario', 'https://usuario@example.com/'],
    ['texto que no es URL', 'no es una url'],
    ['vacío', ''],
    ['ruta relativa', '/problems/pa-1']
  ])('rechaza %s', (_case, url) => {
    expect(isSafeExternalUrl(url)).toBe(false)
  })
})
