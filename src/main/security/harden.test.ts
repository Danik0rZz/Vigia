import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * AUD-20: endurecimiento de las ventanas y de la sesión por defecto, con
 * Electron simulado. Se comprueba lo que hace cada manejador registrado.
 */

type Handler = (...args: unknown[]) => unknown

const fake = vi.hoisted(() => ({
  appHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  openExternal: [] as string[],
  permissionRequest: null as null | ((...args: unknown[]) => unknown),
  permissionCheck: null as null | ((...args: unknown[]) => unknown),
  headersFilter: null as null | { urls: string[] },
  headersListener: null as null | ((...args: unknown[]) => unknown),
  warnings: [] as unknown[][]
}))

vi.mock('electron', () => ({
  app: {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      fake.appHandlers.set(event, handler)
    }
  },
  shell: {
    openExternal: async (url: string) => {
      fake.openExternal.push(url)
    }
  },
  session: {
    defaultSession: {
      setPermissionRequestHandler: (fn: (...args: unknown[]) => unknown) => {
        fake.permissionRequest = fn
      },
      setPermissionCheckHandler: (fn: (...args: unknown[]) => unknown) => {
        fake.permissionCheck = fn
      },
      webRequest: {
        onHeadersReceived: (filter: { urls: string[] }, fn: (...args: unknown[]) => unknown) => {
          fake.headersFilter = filter
          fake.headersListener = fn
        }
      }
    }
  }
}))

vi.mock('electron-log/main', () => ({
  default: {
    warn: (...args: unknown[]) => {
      fake.warnings.push(args)
    }
  }
}))

const { hardenAllWebContents, hardenDefaultSession } = await import('./harden')

const ALLOWED = ['app://vigia']

/** WebContents falso: guarda sus manejadores para llamarlos a mano. */
function fakeContents(): {
  on: (event: string, handler: Handler) => void
  setWindowOpenHandler: (handler: Handler) => void
  handlers: Map<string, Handler>
  openHandler: () => Handler
} {
  const handlers = new Map<string, Handler>()
  let open: Handler | null = null
  return {
    handlers,
    on: (event, handler) => {
      handlers.set(event, handler)
    },
    setWindowOpenHandler: (handler) => {
      open = handler
    },
    openHandler: () => {
      if (open === null) throw new Error('sin setWindowOpenHandler')
      return open
    }
  }
}

/** Crea unos webContents y los pasa por el manejador de web-contents-created. */
function hardened(): ReturnType<typeof fakeContents> {
  hardenAllWebContents(ALLOWED)
  const created = fake.appHandlers.get('web-contents-created')
  if (created === undefined) throw new Error('sin web-contents-created')
  const contents = fakeContents()
  created({}, contents)
  return contents
}

function navigationEvent(): { preventDefault: () => void; prevented: () => boolean } {
  let prevented = false
  return {
    preventDefault: () => {
      prevented = true
    },
    prevented: () => prevented
  }
}

beforeEach(() => {
  fake.appHandlers.clear()
  fake.openExternal.length = 0
  fake.permissionRequest = null
  fake.permissionCheck = null
  fake.headersFilter = null
  fake.headersListener = null
  fake.warnings.length = 0
})

describe('hardenAllWebContents', () => {
  it('se engancha a web-contents-created (antes de crear ventanas)', () => {
    hardenAllWebContents(ALLOWED)
    expect(fake.appHandlers.has('web-contents-created')).toBe(true)
  })

  it('will-navigate: la app sí, cualquier otro origen se bloquea y se registra solo el origen', () => {
    const contents = hardened()
    const navigate = contents.handlers.get('will-navigate')
    expect(navigate).toBeTypeOf('function')

    const inside = navigationEvent()
    navigate?.(inside, 'app://vigia/index.html#/problems')
    expect(inside.prevented()).toBe(false)

    const outside = navigationEvent()
    navigate?.(outside, 'https://example.com/ruta?token=SECRETO')
    expect(outside.prevented()).toBe(true)
    expect(fake.warnings.at(-1)).toEqual(['Navegación bloqueada:', 'https://example.com'])
    expect(JSON.stringify(fake.warnings)).not.toContain('SECRETO')

    const invalid = navigationEvent()
    navigate?.(invalid, 'no es una url')
    expect(invalid.prevented()).toBe(true)
    expect(fake.warnings.at(-1)).toEqual(['Navegación bloqueada:', '(URL no válida)'])
  })

  it('setWindowOpenHandler: siempre deny; http/https van al navegador del sistema', () => {
    const open = hardened().openHandler()
    expect(open({ url: 'https://docs.dynatrace.com/x' })).toEqual({ action: 'deny' })
    expect(open({ url: 'http://example.com/' })).toEqual({ action: 'deny' })
    expect(fake.openExternal).toEqual(['https://docs.dynatrace.com/x', 'http://example.com/'])
  })

  it.each(['file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'app://vigia/otra'])(
    'setWindowOpenHandler: %s → deny, sin abrir nada fuera',
    (url) => {
      const open = hardened().openHandler()
      expect(open({ url })).toEqual({ action: 'deny' })
      expect(fake.openExternal).toEqual([])
      expect(fake.warnings.at(-1)?.[0]).toBe('Apertura de ventana bloqueada:')
    }
  )

  it('will-attach-webview: siempre se impide', () => {
    const attach = hardened().handlers.get('will-attach-webview')
    const event = navigationEvent()
    attach?.(event, {}, {})
    expect(event.prevented()).toBe(true)
  })
})

describe('hardenDefaultSession', () => {
  it.each(['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal'])(
    'deniega la petición del permiso %s',
    (permission) => {
      hardenDefaultSession(undefined)
      const answers: boolean[] = []
      fake.permissionRequest?.({}, permission, (granted: boolean) => answers.push(granted))
      expect(answers).toEqual([false])
    }
  )

  it('la comprobación de permisos siempre dice que no', () => {
    hardenDefaultSession(undefined)
    expect(fake.permissionCheck?.({}, 'media', 'app://vigia', {})).toBe(false)
  })

  it('en producción (sin servidor de desarrollo) no toca las cabeceras', () => {
    hardenDefaultSession(undefined)
    expect(fake.headersListener).toBeNull()
  })

  it('en desarrollo añade la CSP solo a las respuestas del servidor de Vite', () => {
    hardenDefaultSession('http://localhost:5173')
    expect(fake.headersFilter).toEqual({ urls: ['http://localhost:5173/*'] })
    let result: { responseHeaders?: Record<string, string[]> } = {}
    fake.headersListener?.(
      { responseHeaders: { 'content-type': ['text/html'] } },
      (value: typeof result) => {
        result = value
      }
    )
    expect(result.responseHeaders?.['content-type']).toEqual(['text/html'])
    const csp = result.responseHeaders?.['Content-Security-Policy']?.[0] ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).not.toContain('unsafe-eval')
  })
})
