import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * AUD-20: el protocolo app:// sirve solo la carpeta de la interfaz, con la CSP
 * en cada respuesta, y da 404 a lo demás. Electron se simula; net.fetch lee del
 * disco de verdad (una carpeta temporal).
 */

const fake = vi.hoisted(() => ({
  handler: null as null | ((request: Request) => Promise<Response>),
  privileged: [] as unknown[],
  fetched: [] as string[]
}))

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: (schemes: unknown[]) => {
      fake.privileged.push(...schemes)
    },
    handle: (_scheme: string, handler: (request: Request) => Promise<Response>) => {
      fake.handler = handler
    }
  },
  net: {
    fetch: async (url: string) => {
      fake.fetched.push(url)
      // Como net.fetch con file://: si no existe, lanza.
      const body = readFileSync(fileURLToPath(url))
      return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
    }
  }
}))

vi.mock('electron-log/main', () => ({ default: { warn: () => undefined } }))

const { registerAppProtocol, registerAppScheme } = await import('./protocol')

let root: string
let outside: string

beforeEach(() => {
  fake.handler = null
  fake.privileged.length = 0
  fake.fetched.length = 0
  const base = mkdtempSync(join(tmpdir(), 'vigia-protocol-'))
  root = join(base, 'renderer')
  outside = base
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Vigía</title>')
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(join(outside, 'secreto.txt'), 'NO DEBE SALIR')
})

afterEach(() => {
  rmSync(outside, { recursive: true, force: true })
})

async function get(url: string, method = 'GET'): Promise<Response> {
  registerAppProtocol(root)
  if (fake.handler === null) throw new Error('sin protocol.handle')
  return fake.handler(new Request(url, { method }))
}

describe('registerAppScheme', () => {
  it('app:// es estándar, seguro y admite fetch', () => {
    registerAppScheme()
    expect(fake.privileged).toEqual([
      { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
    ])
  })
})

describe('registerAppProtocol', () => {
  it('/ sirve index.html con la CSP y nosniff', async () => {
    const response = await get('app://vigia/')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<title>Vigía</title>')
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('sirve un fichero de dentro de la carpeta', async () => {
    const response = await get('app://vigia/assets/app.js')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('console.log(1)')
  })

  it('%2e%2e lo normaliza la URL antes de llegar: se queda dentro de la carpeta y da 404', async () => {
    const response = await get('app://vigia/%2e%2e/secreto.txt')
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
    // Si se llegó a leer algo, fue dentro de la carpeta de la interfaz.
    for (const url of fake.fetched) expect(fileURLToPath(url).startsWith(root)).toBe(true)
  })

  it.each([
    ['..%2f', 'app://vigia/assets/..%2f..%2fsecreto.txt'],
    ['un byte nulo', 'app://vigia/index.html%00.js'],
    ['una codificación rota', 'app://vigia/%E0%A4%A']
  ])(
    '404 a una ruta fuera de la carpeta o no válida (%s), sin leer el disco',
    async (_case, url) => {
      const response = await get(url)
      expect(response.status).toBe(404)
      expect(await response.text()).toBe('')
      expect(fake.fetched).toEqual([])
    }
  )

  it('404 a un fichero que no existe', async () => {
    const response = await get('app://vigia/no-existe.js')
    expect(response.status).toBe(404)
    expect(fake.fetched).toHaveLength(1)
  })

  it.each(['POST', 'PUT', 'DELETE'])('404 al método %s, sin leer el disco', async (method) => {
    const response = await get('app://vigia/index.html', method)
    expect(response.status).toBe(404)
    expect(fake.fetched).toEqual([])
  })

  it('404 a otro host del esquema, sin leer el disco', async () => {
    const response = await get('app://otro/index.html')
    expect(response.status).toBe(404)
    expect(fake.fetched).toEqual([])
  })
})
