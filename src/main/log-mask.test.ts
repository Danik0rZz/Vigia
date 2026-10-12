import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import type { LogMessage } from 'electron-log'
import { maskLogMessage } from './log-mask'

// CA6 (0083): electron y electron-log simulados, como el CA4 de la 0060.
const fake = vi.hoisted(() => ({
  log: {
    transports: { file: {} as Record<string, unknown>, console: {} as Record<string, unknown> },
    errorHandler: { startCatching: (): void => undefined },
    hooks: [] as ((message: LogMessage, transport?: unknown, name?: string) => LogMessage | false)[]
  }
}))

vi.mock('electron', () => ({ app: { isPackaged: true } }))
vi.mock('electron-log/main', () => ({ default: fake.log }))
vi.mock('./paths', () => ({ logsDir: () => 'C:\\datos-de-prueba\\logs' }))

const { initLogging } = await import('./logging')

/**
 * Ficha 0060 (S-03): filtro final del log. `maskLogMessage` recibe el mensaje
 * de electron-log (el que llega a `log.hooks`) y enmascara los textos de
 * `data`: cadenas, `Error` (mensaje y pila, en una copia) y los valores de
 * texto de los objetos planos. Tokens inventados.
 */

const PUBLIC_ID = 'PUBLICAPRUEBA0000000000A'
const SECRET_PART = 'SECRETOCLASICO'.padEnd(64, 'X')
const TOKEN = `dt0c01.${PUBLIC_ID}.${SECRET_PART}`
const DATE = new Date('2026-10-10T08:00:00.000Z')

function message(...data: unknown[]): LogMessage {
  return { data, date: DATE, level: 'error' }
}

function masked(...data: unknown[]): unknown[] {
  const result = maskLogMessage(message(...data))
  expect(result).not.toBe(false)
  return (result as LogMessage).data
}

describe('CA3 (0060): maskLogMessage enmascara los secretos del mensaje', () => {
  it('un Error: enmascara el Api-Token del mensaje y de la pila', () => {
    const error = new Error(`fallo de la librería con Api-Token ${TOKEN}`)
    const [out] = masked(error)
    expect(out).toBeInstanceOf(Error)
    const copy = out as Error
    expect(copy.message).not.toContain(SECRET_PART)
    expect(copy.message).toContain('Api-Token ***')
    expect(copy.stack ?? '').not.toContain(SECRET_PART)
    expect(copy.stack ?? '').not.toBe('')
  })

  it('un Error con el secreto solo en la pila también se enmascara', () => {
    const error = new Error('fallo sin datos')
    error.stack = `Error: fallo sin datos\n    at llamar (Bearer ${SECRET_PART})`
    const copy = masked(error)[0] as Error
    expect(copy.stack).not.toContain(SECRET_PART)
    expect(copy.stack).toContain('Bearer ***')
  })

  it('un Error: conserva name y cause, y no modifica el original', () => {
    const cause = new Error('causa')
    // Pila fija sin rutas: la real pasa por la carpeta del checkout y, si está bajo C:\Users,
    // desde la 0093 se enmascara y la cause ya no se conservaría por identidad.
    cause.stack = 'Error: causa'
    const error = new Error(`token ${TOKEN}`, { cause })
    error.name = 'FetchError'
    const originalMessage = error.message
    const copy = masked(error)[0] as Error
    expect(copy.name).toBe('FetchError')
    expect(copy.cause).toBe(cause)
    expect(error.message).toBe(originalMessage)
  })

  it('una cadena: conserva la parte pública de dt0c01.<pública>.<secreta>', () => {
    const [out] = masked(`token caducado: ${TOKEN} (renovar)`)
    expect(out).toBe(`token caducado: dt0c01.${PUBLIC_ID}.*** (renovar)`)
  })

  it('un objeto plano: enmascara sus valores de texto y deja el resto igual', () => {
    const [out] = masked({
      header: `Bearer ${SECRET_PART}`,
      token: TOKEN,
      status: 401,
      retried: true,
      missing: null
    })
    expect(out).toEqual({
      header: 'Bearer ***',
      token: `dt0c01.${PUBLIC_ID}.***`,
      status: 401,
      retried: true,
      missing: null
    })
  })

  it('los valores que no son texto no cambian', () => {
    const when = new Date('2026-10-10T09:30:00.000Z')
    const out = masked(42, true, null, undefined, when)
    expect(out).toEqual([42, true, null, undefined, when])
    expect(out[4]).toBe(when)
  })

  it('conserva el resto del mensaje (nivel y fecha) y varios argumentos', () => {
    const result = maskLogMessage(message('primero', `Api-Token ${TOKEN}`)) as LogMessage
    expect(result.level).toBe('error')
    expect(result.date).toEqual(DATE)
    expect(result.data).toEqual(['primero', 'Api-Token ***'])
  })
})

/**
 * Ficha 0083: el filtro final enmascara también los objetos anidados, las
 * listas, la `cause` de un `Error` (encadenada) y sus propiedades propias, sin
 * colgarse con referencias circulares y sin tocar el original. Tokens
 * inventados.
 */

type Tree = Record<string, unknown>

describe('CA1 (0083): enmascara los textos de objetos anidados y de listas', () => {
  it('un Api-Token a tres niveles de profundidad sale enmascarado', () => {
    const [out] = masked({ level1: { level2: { level3: `Api-Token ${TOKEN}` } } })
    expect(out).toEqual({ level1: { level2: { level3: 'Api-Token ***' } } })
  })

  it('un Api-Token dentro de una lista (también de objetos) sale enmascarado', () => {
    const [out] = masked({
      list: [`Api-Token ${TOKEN}`, 7, { header: `Bearer ${SECRET_PART}` }, [TOKEN]]
    })
    expect(out).toEqual({
      list: ['Api-Token ***', 7, { header: 'Bearer ***' }, [`dt0c01.${PUBLIC_ID}.***`]]
    })
    const [list] = masked([`Api-Token ${TOKEN}`])
    expect(list).toEqual(['Api-Token ***'])
  })

  it('a la profundidad del fichero de log (5) enmascara el texto sin sustituirlo', () => {
    const [out] = masked({ a: { b: { c: { d: { e: `Api-Token ${TOKEN}` } } } } })
    expect(out).toEqual({ a: { b: { c: { d: { e: 'Api-Token ***' } } } } })
  })

  it('más allá de cualquier límite, el secreto no sale', () => {
    let deep: Tree = { token: `Api-Token ${TOKEN}` }
    for (let i = 0; i < 60; i++) deep = { next: deep }
    const [out] = masked(deep)
    expect(JSON.stringify(out)).not.toContain(SECRET_PART)
  })
})

describe('CA2 (0083): enmascara la cause de un Error, también encadenada', () => {
  it('una cause de texto sale enmascarada', () => {
    const error = new Error('fallo', { cause: `Api-Token ${TOKEN}` })
    const copy = masked(error)[0] as Error
    expect(copy.cause).toBe('Api-Token ***')
  })

  it('una cause objeto sale enmascarada', () => {
    const error = new Error('fallo', { cause: { header: `Bearer ${SECRET_PART}`, status: 401 } })
    const copy = masked(error)[0] as Error
    expect(copy.cause).toEqual({ header: 'Bearer ***', status: 401 })
  })

  it('una cause Error: enmascara su mensaje y su pila y conserva clase y name', () => {
    const cause = new TypeError(`fetch falló con Api-Token ${TOKEN}`)
    cause.stack = `TypeError: fetch falló con Api-Token ${TOKEN}\n    at pedir (Bearer ${SECRET_PART})`
    const error = new Error('fallo', { cause })
    const copy = masked(error)[0] as Error
    const copyCause = copy.cause as Error
    expect(copyCause).toBeInstanceOf(TypeError)
    expect(copyCause.name).toBe('TypeError')
    expect(copyCause.message).toBe('fetch falló con Api-Token ***')
    expect(copyCause.stack ?? '').not.toContain(SECRET_PART)
    expect(copyCause.stack ?? '').toContain('Bearer ***')
  })

  it('una cause encadenada a dos niveles sale enmascarada y la cadena se conserva', () => {
    class FetchFailure extends Error {
      constructor(message: string, options?: ErrorOptions) {
        super(message, options)
        this.name = 'FetchFailure'
      }
    }
    const inner = new RangeError(`detalle con Api-Token ${TOKEN}`)
    const middle = new FetchFailure('petición rechazada', { cause: inner })
    const error = new Error('fallo general', { cause: middle })
    error.name = 'SyncError'
    const copy = masked(error)[0] as Error
    expect(copy.name).toBe('SyncError')
    const copyMiddle = copy.cause as Error
    expect(copyMiddle).toBeInstanceOf(FetchFailure)
    expect(copyMiddle.name).toBe('FetchFailure')
    expect(copyMiddle.message).toBe('petición rechazada')
    const copyInner = copyMiddle.cause as Error
    expect(copyInner).toBeInstanceOf(RangeError)
    expect(copyInner.name).toBe('RangeError')
    expect(copyInner.message).toBe('detalle con Api-Token ***')
    expect(copyInner.stack ?? '').not.toContain(SECRET_PART)
  })
})

describe('Especificación (0083): propiedades propias de un Error', () => {
  it('enmascara los errors de un AggregateError y un body añadido', () => {
    const aggregate = new AggregateError(
      [new Error(`uno con Api-Token ${TOKEN}`), `dos con Bearer ${SECRET_PART}`],
      'varios fallos'
    )
    const withBody = Object.assign(new Error('respuesta 401'), {
      body: { detail: `Api-Token ${TOKEN}` }
    })
    const [outAggregate, outBody] = masked(aggregate, withBody) as [AggregateError, Error & Tree]
    expect(outAggregate).toBeInstanceOf(AggregateError)
    expect((outAggregate.errors[0] as Error).message).toBe('uno con Api-Token ***')
    expect(outAggregate.errors[1]).toBe('dos con Bearer ***')
    expect(outBody.body).toEqual({ detail: 'Api-Token ***' })
  })
})

/**
 * Lo que escribiría el transporte de fichero de electron-log 5.4.4
 * (`transforms/object.js`): `JSON.stringify` con `Map` y `Set` convertidos y,
 * si falla, `util.inspect` con profundidad 5. El secreto no puede salir por
 * ninguno de los dos caminos.
 */
function written(value: unknown): string {
  const json = JSON.stringify(value, (_key, inner: unknown) => {
    if (inner instanceof Map) return Object.fromEntries(inner)
    if (inner instanceof Set) return Array.from(inner)
    return inner
  })
  return `${json}\n${inspect(value, { depth: 5 })}`
}

describe('Especificación (0083): Map, Set, instancias de clase y toJSON', () => {
  it('enmascara claves y valores de un Map y los valores de un Set', () => {
    const headers = new Map<string, unknown>([
      ['authorization', `Api-Token ${TOKEN}`],
      [`clave con Bearer ${SECRET_PART}`, 'valor'],
      ['anidado', { token: `Api-Token ${TOKEN}` }]
    ])
    const tokens = new Set([`Api-Token ${TOKEN}`, 'sin secretos'])
    const [outMap, outSet] = masked(headers, tokens) as [Map<string, unknown>, Set<string>]
    expect(outMap).toBeInstanceOf(Map)
    expect(outMap.get('authorization')).toBe('Api-Token ***')
    expect(outMap.get('clave con Bearer ***')).toBe('valor')
    expect(outMap.get('anidado')).toEqual({ token: 'Api-Token ***' })
    expect(outSet).toBeInstanceOf(Set)
    expect([...outSet]).toEqual(['Api-Token ***', 'sin secretos'])
    expect(written(outMap)).not.toContain(SECRET_PART)
    expect(written(outSet)).not.toContain(SECRET_PART)
    expect(headers.get('authorization')).toBe(`Api-Token ${TOKEN}`)
  })

  it('enmascara las propiedades propias de una instancia de clase', () => {
    class Client {
      token = `Api-Token ${TOKEN}`
      nested = { header: `Bearer ${SECRET_PART}` }
      status = 401
    }
    const client = new Client()
    const [out] = masked(client) as [Tree]
    expect(out.token).toBe('Api-Token ***')
    expect(out.nested).toEqual({ header: 'Bearer ***' })
    expect(out.status).toBe(401)
    expect(written(out)).not.toContain(SECRET_PART)
    expect(client.token).toBe(`Api-Token ${TOKEN}`)
  })

  it('enmascara lo que devuelve toJSON', () => {
    const withToJson = {
      hidden: 'sin secretos',
      toJSON: () => ({ auth: `Api-Token ${TOKEN}` })
    }
    class Secret {
      toJSON(): unknown {
        return [`Bearer ${SECRET_PART}`]
      }
    }
    const [outObject, outInstance] = masked(withToJson, new Secret())
    expect(written(outObject)).not.toContain(SECRET_PART)
    expect(written(outInstance)).not.toContain(SECRET_PART)
  })

  it('un toJSON que lanza descarta el mensaje', () => {
    const broken = {
      toJSON: (): never => {
        throw new Error(`fallo con Api-Token ${TOKEN}`)
      }
    }
    expect(maskLogMessage(message(`Api-Token ${TOKEN}`, broken))).toBe(false)
  })

  it('las claves símbolo no salen sin enmascarar por util.inspect', () => {
    const key = Symbol('secreto')
    const object: Record<string | symbol, unknown> = { visible: 'sin secretos' }
    object[key] = `Api-Token ${TOKEN}`
    const [out] = masked(object)
    expect(inspect(out, { depth: 5 })).not.toContain(SECRET_PART)
  })
})

describe('CA3 (0083): referencias circulares', () => {
  it('un objeto que se contiene a sí mismo termina sin error y enmascarado', () => {
    const loop: Tree = { token: `Api-Token ${TOKEN}`, nested: { header: `Bearer ${SECRET_PART}` } }
    loop.self = loop
    ;(loop.nested as Tree).parent = loop
    const list: unknown[] = [`Api-Token ${TOKEN}`]
    list.push(list)
    const out = masked(loop, list)
    const outLoop = out[0] as Tree
    expect(outLoop.token).toBe('Api-Token ***')
    expect((outLoop.nested as Tree).header).toBe('Bearer ***')
    expect((out[1] as unknown[])[0]).toBe('Api-Token ***')
  })

  it('un Error que es su propia cause termina sin error y enmascarado', () => {
    const error = new Error(`Api-Token ${TOKEN}`)
    ;(error as Error & { cause: unknown }).cause = error
    const copy = masked(error)[0] as Error
    expect(copy.message).toBe('Api-Token ***')
    expect(copy.stack ?? '').not.toContain(SECRET_PART)
  })
})

describe('CA4 (0083): el valor original no cambia', () => {
  it('objetos, listas y la cadena de cause originales quedan igual', () => {
    const inner = new Error(`interno con Api-Token ${TOKEN}`)
    const innerStack = inner.stack
    const error = new Error(`externo con Api-Token ${TOKEN}`, { cause: inner })
    const tree: Tree = {
      deep: { deeper: { text: `Api-Token ${TOKEN}` } },
      list: [`Bearer ${SECRET_PART}`, { token: TOKEN }]
    }
    masked(tree, error)
    expect(tree).toEqual({
      deep: { deeper: { text: `Api-Token ${TOKEN}` } },
      list: [`Bearer ${SECRET_PART}`, { token: TOKEN }]
    })
    expect(error.message).toBe(`externo con Api-Token ${TOKEN}`)
    expect(error.cause).toBe(inner)
    expect(inner.message).toBe(`interno con Api-Token ${TOKEN}`)
    expect(inner.stack).toBe(innerStack)
  })
})

describe('CA5 (0083): los casos del CA3 de la 0060 siguen igual, también anidados', () => {
  it('conserva la parte pública de dt0c01.<pública>.<secreta> en un objeto anidado', () => {
    const [out] = masked({ request: { auth: { token: `token ${TOKEN}` } } })
    expect(out).toEqual({ request: { auth: { token: `token dt0c01.${PUBLIC_ID}.***` } } })
  })

  it('los valores anidados que no son texto quedan igual', () => {
    const when = new Date('2026-10-10T09:30:00.000Z')
    const [out] = masked({
      meta: { status: 401, retried: false, missing: null, when, list: [1, true] }
    })
    const meta = (out as Tree).meta as Tree
    expect(meta).toEqual({ status: 401, retried: false, missing: null, when, list: [1, true] })
    expect(meta.when).toBeInstanceOf(Date)
    expect((meta.when as Date).getTime()).toBe(when.getTime())
  })

  it('un Error con cause sin secretos conserva name y cause', () => {
    const cause = new Error('causa')
    const error = new Error(`token ${TOKEN}`, { cause })
    error.name = 'FetchError'
    const copy = masked(error)[0] as Error
    expect(copy.name).toBe('FetchError')
    expect(copy.message).toBe(`token dt0c01.${PUBLIC_ID}.***`)
    expect(copy.cause).toBeInstanceOf(Error)
    expect((copy.cause as Error).message).toBe('causa')
  })
})

describe('CA6 (0083): si el filtro falla, el mensaje se descarta', () => {
  it('el hook de initLogging devuelve false y no deja pasar el mensaje sin filtrar', () => {
    const trap = (): never => {
      throw new Error('fallo simulado del filtro')
    }
    // Un valor que hace fallar cualquier recorrido: toda operación sobre él lanza.
    const hostile = new Proxy(
      {},
      { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, has: trap }
    )
    fake.log.hooks = []
    initLogging()
    const hook = fake.log.hooks[0]
    expect(hook).toBeTypeOf('function')
    let result: LogMessage | false | undefined
    expect(() => {
      result = hook?.(message(`Api-Token ${TOKEN}`, hostile), undefined, 'file')
    }).not.toThrow()
    expect(result).toBe(false)
  })
})

/**
 * Ficha 0093: el filtro final del log quita también el nombre del usuario de
 * Windows (y de Linux) de las rutas, con la misma regla que
 * `maskErrorDetails`, en todo lo que recorre desde la 0083. Nombres de
 * usuario y rutas inventados.
 */

const WIN_USER = 'Usuaria.Inventada'
const UNIX_USER = 'inventado'
const WIN_PATH = `C:\\Users\\${WIN_USER}\\Descargas\\vigia\\resources\\app.asar\\out\\main\\index.js`
const WIN_MASKED =
  'C:\\Users\\<usuario>\\Descargas\\vigia\\resources\\app.asar\\out\\main\\index.js'
const UNIX_PATH = `/home/${UNIX_USER}/.config/vigia/logs/main.log`
const UNIX_MASKED = '/home/<usuario>/.config/vigia/logs/main.log'

describe('CA1 (0093): la pila de un Error sale sin el usuario de Windows', () => {
  it('cambia C:\\Users\\<nombre>\\… por C:\\Users\\<usuario>\\… y no toca el original', () => {
    const error = new Error('fallo al arrancar')
    const stack = `Error: fallo al arrancar\n    at arrancar (${WIN_PATH}:10:5)`
    error.stack = stack
    const copy = masked(error)[0] as Error
    expect(copy).toBeInstanceOf(Error)
    expect(copy.stack).toBe(`Error: fallo al arrancar\n    at arrancar (${WIN_MASKED}:10:5)`)
    expect(copy.stack).not.toContain(WIN_USER)
    expect(error.stack).toBe(stack)
    expect(error.message).toBe('fallo al arrancar')
  })
})

describe('CA2 (0093): cadenas, objetos anidados y cause salen sin el usuario', () => {
  it('una cadena con una ruta de Windows y otra de Linux', () => {
    const [out] = masked(`copia en ${WIN_PATH} y en ${UNIX_PATH}`)
    expect(out).toBe(`copia en ${WIN_MASKED} y en ${UNIX_MASKED}`)
  })

  it('un objeto anidado con rutas de usuario', () => {
    const tree = { a: { b: { win: WIN_PATH, list: [UNIX_PATH, 7] } } }
    const [out] = masked(tree)
    expect(out).toEqual({ a: { b: { win: WIN_MASKED, list: [UNIX_MASKED, 7] } } })
    expect(tree.a.b.win).toBe(WIN_PATH)
  })

  it('la cause de un error (texto y Error) con rutas de usuario', () => {
    const inner = new Error(`no se pudo leer ${UNIX_PATH}`)
    inner.stack = `Error: no se pudo leer ${UNIX_PATH}\n    at leer (${WIN_PATH}:3:1)`
    const error = new Error(`fallo en ${WIN_PATH}`, { cause: inner })
    const withText = new Error('fallo', { cause: `ruta ${WIN_PATH}` })
    const [copy, copyText] = masked(error, withText) as [Error, Error]
    expect(copy.message).toBe(`fallo en ${WIN_MASKED}`)
    const copyInner = copy.cause as Error
    expect(copyInner.message).toBe(`no se pudo leer ${UNIX_MASKED}`)
    expect(copyInner.stack ?? '').not.toContain(WIN_USER)
    expect(copyInner.stack ?? '').not.toContain(UNIX_USER)
    expect(copyText.cause).toBe(`ruta ${WIN_MASKED}`)
    expect(inner.message).toBe(`no se pudo leer ${UNIX_PATH}`)
  })
})
