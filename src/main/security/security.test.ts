import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAppPath } from './app-path'
import { buildCsp } from './csp'
import { isAllowedOrigin, isSafeExternalUrl, originOf } from './origins'

describe('orígenes', () => {
  it('obtiene el origen de esquemas propios y estándar', () => {
    expect(originOf('app://vigia/index.html')).toBe('app://vigia')
    expect(originOf('http://localhost:5173/src/main.tsx')).toBe('http://localhost:5173')
    expect(originOf('no es una url')).toBeNull()
    expect(originOf('file:///C:/Windows/system.ini')).toBeNull()
  })

  it('solo acepta el origen de la app', () => {
    const allowed = ['app://vigia']
    expect(isAllowedOrigin('app://vigia/index.html#/problemas', allowed)).toBe(true)
    expect(isAllowedOrigin('app://otro/index.html', allowed)).toBe(false)
    expect(isAllowedOrigin('https://vigia/', allowed)).toBe(false)
    expect(isAllowedOrigin('https://example.com/?next=app://vigia', allowed)).toBe(false)
    expect(isAllowedOrigin(undefined, allowed)).toBe(false)
  })

  it('solo abre fuera de la app enlaces http y https', () => {
    expect(isSafeExternalUrl('https://docs.dynatrace.com/')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
    expect(isSafeExternalUrl('file:///C:/Windows/system32/cmd.exe')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('ms-msdt:/id')).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
  })
})

describe('CSP', () => {
  it('en producción es exactamente la política acordada', () => {
    expect(buildCsp()).toBe(
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "worker-src 'self' blob:",
        "connect-src 'self'",
        "object-src 'none'",
        "frame-src 'none'",
        "base-uri 'none'",
        "form-action 'none'"
      ].join('; ')
    )
  })

  it('nunca permite eval ni orígenes remotos', () => {
    for (const csp of [buildCsp(), buildCsp({ devServerOrigin: 'http://localhost:5173' })]) {
      expect(csp).not.toContain('unsafe-eval')
      expect(csp).not.toContain('https:')
      expect(csp).not.toContain('*')
    }
  })

  it('en desarrollo solo añade lo que necesita la recarga en caliente', () => {
    const csp = buildCsp({ devServerOrigin: 'http://localhost:5173' })
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).toContain("connect-src 'self' ws://localhost:5173")
  })
})

describe('rutas del protocolo app://', () => {
  const root = resolve('/opt/vigia/out/renderer')

  it('sirve index.html en la raíz y los ficheros de la carpeta', () => {
    expect(resolveAppPath(root, '/')).toBe(join(root, 'index.html'))
    expect(resolveAppPath(root, '/index.html')).toBe(join(root, 'index.html'))
    expect(resolveAppPath(root, '/assets/index-abc123.js')).toBe(
      join(root, 'assets', 'index-abc123.js')
    )
  })

  it('rechaza cualquier ruta que salga de la carpeta', () => {
    expect(resolveAppPath(root, '/../main/index.js')).toBeNull()
    expect(resolveAppPath(root, '/assets/../../../etc/passwd')).toBeNull()
    expect(resolveAppPath(root, '/%2e%2e/%2e%2e/secreto.txt')).toBeNull()
    expect(resolveAppPath(root, '/..%2f..%2fsecreto.txt')).toBeNull()
  })

  it('rechaza rutas mal codificadas o con bytes nulos', () => {
    expect(resolveAppPath(root, '/%E0%A4%A')).toBeNull()
    expect(resolveAppPath(root, '/index.html%00.png')).toBeNull()
  })
})
