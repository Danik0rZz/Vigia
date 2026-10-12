import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DomainError } from '../errors'
import type { CertificatePin } from '@shared/dynatrace'
import type { CertificateLevel } from '@shared/tenants'

/**
 * AUD-11: sesión de red por entorno y su verificador de certificados. Electron
 * se sustituye por un `session.fromPartition` falso que guarda el verificador
 * de cada partición para llamarlo a mano.
 */

type VerifyRequest = { hostname: string; errorCode: number; certificate: { fingerprint: string } }
type VerifyProc = (request: VerifyRequest, callback: (result: number) => void) => void

const fake = vi.hoisted(() => {
  const partitions: string[] = []
  const procs = new Map<string, unknown>()
  const fetches = new Map<string, ReturnType<typeof vi.fn>>()
  return { partitions, procs, fetches }
})

vi.mock('electron', async () => {
  const { vi: v } = await import('vitest')
  return {
    session: {
      fromPartition(partition: string) {
        fake.partitions.push(partition)
        const fetchMock = v.fn(async () => new Response('{}'))
        fake.fetches.set(partition, fetchMock)
        return {
          setCertificateVerifyProc(fn: unknown) {
            fake.procs.set(partition, fn)
          },
          fetch: fetchMock
        }
      }
    }
  }
})

const { createEnvironmentNetwork } = await import('./network')

const ACCEPT = 0
const REJECT = -2
const USE_CHROMIUM = -3
const ENV = 'env-a'
const OTHER = 'env-b'
const HOST = 'abc123.live.dynatrace.example'
const FP = 'AA:BB:CC'
const OTHER_FP = 'DD:EE:FF'

let level: CertificateLevel
let pins: CertificatePin[]
let hosts: string[]
let throwOnLevel: Error | null

function build(): ReturnType<typeof createEnvironmentNetwork> {
  return createEnvironmentNetwork({
    certificateLevel: () => {
      if (throwOnLevel !== null) throw throwOnLevel
      return level
    },
    environmentHosts: () => hosts,
    pins: {
      list: () => pins,
      pin: () => undefined,
      unpin: () => undefined,
      forHost: () => []
    }
  })
}

/** Abre la sesión del entorno (con una petición) y devuelve su verificador. */
async function verifierOf(
  network: ReturnType<typeof createEnvironmentNetwork>,
  envId: string
): Promise<VerifyProc> {
  await network.fetchFor(envId)(`https://${HOST}/api/v2/problems`)
  const partition = fake.partitions.at(-1) ?? ''
  const proc = fake.procs.get(partition)
  if (typeof proc !== 'function') throw new Error(`sin verificador en ${partition}`)
  return proc as VerifyProc
}

/** Llama al verificador y devuelve todos los valores con que respondió. */
function verify(proc: VerifyProc, request: Partial<VerifyRequest> = {}): number[] {
  const calls: number[] = []
  proc(
    {
      hostname: HOST,
      errorCode: 0,
      certificate: { fingerprint: FP },
      ...request
    },
    (result) => calls.push(result)
  )
  return calls
}

beforeEach(() => {
  fake.partitions.length = 0
  fake.procs.clear()
  fake.fetches.clear()
  level = 'system'
  pins = []
  hosts = [HOST]
  throwOnLevel = null
})

describe('particiones', () => {
  it('una por entorno, env-<id>-0; se reutiliza mientras no haya reset', async () => {
    const network = build()
    await network.fetchFor(ENV)('https://x/')
    await network.fetchFor(ENV)('https://x/')
    expect(fake.partitions).toEqual([`env-${ENV}-0`])
  })

  it('tras reset, la siguiente petición crea env-<id>-1', async () => {
    const network = build()
    await network.fetchFor(ENV)('https://x/')
    network.reset(ENV)
    await network.fetchFor(ENV)('https://x/')
    network.reset(ENV)
    await network.fetchFor(ENV)('https://x/')
    expect(fake.partitions).toEqual([`env-${ENV}-0`, `env-${ENV}-1`, `env-${ENV}-2`])
  })

  it('otro entorno no comparte sesión, y su reset no toca la del primero', async () => {
    const network = build()
    await network.fetchFor(ENV)('https://x/')
    await network.fetchFor(OTHER)('https://x/')
    network.reset(OTHER)
    await network.fetchFor(ENV)('https://x/')
    expect(fake.partitions).toEqual([`env-${ENV}-0`, `env-${OTHER}-0`])
  })

  it('el verificador se pone antes de la primera petición, y fetch recibe la URL como texto', async () => {
    const network = build()
    await network.fetchFor(ENV)(new URL(`https://${HOST}/api`), { method: 'GET' })
    const partition = `env-${ENV}-0`
    expect(fake.procs.has(partition)).toBe(true)
    expect(fake.fetches.get(partition)).toHaveBeenCalledWith(`https://${HOST}/api`, {
      method: 'GET'
    })
  })
})

describe('verificador', () => {
  it('system con errorCode 0 → USE_CHROMIUM, sin nada observado', async () => {
    const network = build()
    const proc = await verifierOf(network, ENV)
    expect(verify(proc)).toEqual([USE_CHROMIUM])
    expect(network.tlsFailure(ENV, `${HOST}:443`)).toBeNull()
    expect(network.untrusted(ENV)).toEqual([])
  })

  it('system con errorCode ≠ 0 → USE_CHROMIUM, y untrusted lo lista tras tlsFailure', async () => {
    const network = build()
    const proc = await verifierOf(network, ENV)
    expect(verify(proc, { errorCode: -202 })).toEqual([USE_CHROMIUM])
    // Sin tlsFailure todavía, no se lista (solo los hosts que fallaron desde el cliente).
    expect(network.untrusted(ENV)).toEqual([])
    expect(network.tlsFailure(ENV, `${HOST}:443`)).toBe('untrusted')
    expect(network.untrusted(ENV)).toEqual([
      { host: `${HOST}:443`, fingerprint: FP, reason: 'untrusted', previousFingerprint: null }
    ])
  })

  it('pinned con la huella fijada → ACCEPT (aunque Chromium no confíe)', async () => {
    level = 'pinned'
    pins = [{ host: `${HOST}:443`, fingerprint: FP }]
    const network = build()
    const proc = await verifierOf(network, ENV)
    expect(verify(proc, { errorCode: -202 })).toEqual([ACCEPT])
    expect(network.tlsFailure(ENV, `${HOST}:443`)).toBeNull()
  })

  it('pinned con otra huella → REJECT, mismatch y previousFingerprint de la fijada', async () => {
    level = 'pinned'
    pins = [{ host: `${HOST}:443`, fingerprint: FP }]
    const network = build()
    const proc = await verifierOf(network, ENV)
    expect(verify(proc, { certificate: { fingerprint: OTHER_FP } })).toEqual([REJECT])
    expect(network.tlsFailure(ENV, `${HOST}:443`)).toBe('mismatch')
    expect(network.untrusted(ENV)).toEqual([
      { host: `${HOST}:443`, fingerprint: OTHER_FP, reason: 'mismatch', previousFingerprint: FP }
    ])
  })

  it('pinned: las huellas de otro host no cuentan (→ Chromium decide)', async () => {
    level = 'pinned'
    pins = [{ host: 'otro.example:443', fingerprint: OTHER_FP }]
    const network = build()
    const proc = await verifierOf(network, ENV)
    expect(verify(proc)).toEqual([USE_CHROMIUM])
  })

  it('ignore en un host del entorno → ACCEPT', async () => {
    level = 'ignore'
    const network = build()
    const proc = await verifierOf(network, ENV)
    expect(verify(proc, { errorCode: -202 })).toEqual([ACCEPT])
  })

  it('ignore en otro host → lo que diga verifyCertificate (sin huellas, Chromium)', async () => {
    level = 'ignore'
    hosts = ['otro.example']
    const network = build()
    const proc = await verifierOf(network, ENV)
    expect(verify(proc, { errorCode: -202 })).toEqual([USE_CHROMIUM])
    expect(network.tlsFailure(ENV, `${HOST}:443`)).toBe('untrusted')
  })

  it('ignore en otro host con huella fijada distinta → REJECT', async () => {
    level = 'ignore'
    hosts = ['otro.example']
    pins = [{ host: HOST, fingerprint: OTHER_FP }]
    const network = build()
    const proc = await verifierOf(network, ENV)
    expect(verify(proc)).toEqual([REJECT])
  })

  it('un certificado aceptado después borra lo observado del host', async () => {
    level = 'pinned'
    pins = [{ host: HOST, fingerprint: FP }]
    const network = build()
    const proc = await verifierOf(network, ENV)
    verify(proc, { certificate: { fingerprint: OTHER_FP } })
    expect(network.tlsFailure(ENV, HOST)).toBe('mismatch')
    expect(verify(proc)).toEqual([ACCEPT])
    expect(network.tlsFailure(ENV, HOST)).toBeNull()
  })
})

describe('AUD-11: si algo lanza dentro del verificador', () => {
  it('entorno borrado (certificateLevel lanza NOT_FOUND) → REJECT una sola vez, sin excepción fuera', async () => {
    const network = build()
    const proc = await verifierOf(network, ENV)
    throwOnLevel = new DomainError('NOT_FOUND', 'El entorno no existe')
    let calls: number[] = []
    expect(() => {
      calls = verify(proc, { errorCode: 0 })
    }).not.toThrow()
    expect(calls).toEqual([REJECT])
  })

  it('pins.list o environmentHosts que lanzan → REJECT una sola vez', async () => {
    for (const broken of ['pins', 'hosts'] as const) {
      const network = createEnvironmentNetwork({
        certificateLevel: () => 'ignore',
        environmentHosts: () => {
          if (broken === 'hosts') throw new Error('roto')
          return [HOST]
        },
        pins: {
          list: () => {
            if (broken === 'pins') throw new Error('roto')
            return []
          },
          pin: () => undefined,
          unpin: () => undefined,
          forHost: () => []
        }
      })
      const proc = await verifierOf(network, `${ENV}-${broken}`)
      expect(verify(proc), broken).toEqual([REJECT])
    }
  })

  it('nunca acepta por error: con ignore en un host del entorno, si lanza, REJECT', async () => {
    level = 'ignore'
    const network = build()
    const proc = await verifierOf(network, ENV)
    throwOnLevel = new Error('fallo inesperado')
    expect(verify(proc, { errorCode: -202 })).toEqual([REJECT])
  })
})

describe('hosts con puerto', () => {
  it('el verificador ve el hostname; tlsFailure("h:8443") lo relaciona y untrusted devuelve el host con puerto', async () => {
    level = 'pinned'
    pins = [{ host: `${HOST}:8443`, fingerprint: FP }]
    const network = build()
    const proc = await verifierOf(network, ENV)
    expect(verify(proc, { certificate: { fingerprint: OTHER_FP } })).toEqual([REJECT])
    expect(network.tlsFailure(ENV, `${HOST}:8443`)).toBe('mismatch')
    expect(network.untrusted(ENV)).toEqual([
      { host: `${HOST}:8443`, fingerprint: OTHER_FP, reason: 'mismatch', previousFingerprint: FP }
    ])
  })
})

describe('clearFailures y reset', () => {
  it('clearFailures borra los hosts fallidos pero no lo observado (Chromium cachea el rechazo)', async () => {
    const network = build()
    const proc = await verifierOf(network, ENV)
    verify(proc, { errorCode: -202 })
    network.tlsFailure(ENV, `${HOST}:443`)
    network.clearFailures(ENV)
    expect(network.untrusted(ENV)).toEqual([])
    // Sin volver a llamar al verificador, lo observado sigue: el siguiente fallo lo reconoce.
    expect(network.tlsFailure(ENV, `${HOST}:443`)).toBe('untrusted')
    expect(network.untrusted(ENV)).toHaveLength(1)
  })

  it('reset borra lo observado y los fallos', async () => {
    const network = build()
    const proc = await verifierOf(network, ENV)
    verify(proc, { errorCode: -202 })
    network.tlsFailure(ENV, `${HOST}:443`)
    network.reset(ENV)
    expect(network.untrusted(ENV)).toEqual([])
    expect(network.tlsFailure(ENV, `${HOST}:443`)).toBeNull()
  })

  it('lo observado es por entorno', async () => {
    const network = build()
    const proc = await verifierOf(network, ENV)
    verify(proc, { errorCode: -202 })
    expect(network.tlsFailure(OTHER, `${HOST}:443`)).toBeNull()
    expect(network.untrusted(OTHER)).toEqual([])
  })
})

describe('AUD-21 (P3-2): wasOffered, lo único que certificates:pin acepta', () => {
  /** Una prueba con un certificado no confiable en `host`, ya ofrecido con untrusted(). */
  async function offeredOnce(host = `${HOST}:443`): Promise<ReturnType<typeof build>> {
    const network = build()
    const proc = await verifierOf(network, ENV)
    verify(proc, { errorCode: -202 })
    network.tlsFailure(ENV, host)
    expect(network.untrusted(ENV)).toEqual([
      { host, fingerprint: FP, reason: 'untrusted', previousFingerprint: null }
    ])
    return network
  }

  it('true para el host (con puerto) y la huella que ofreció untrusted()', async () => {
    const network = await offeredOnce()
    expect(network.wasOffered(ENV, `${HOST}:443`, FP)).toBe(true)
  })

  it('false con otra huella, otro host, otro puerto o el host sin puerto', async () => {
    const network = await offeredOnce()
    expect(network.wasOffered(ENV, `${HOST}:443`, OTHER_FP)).toBe(false)
    expect(network.wasOffered(ENV, 'otro.example:443', FP)).toBe(false)
    expect(network.wasOffered(ENV, `${HOST}:8443`, FP)).toBe(false)
    expect(network.wasOffered(ENV, HOST, FP)).toBe(false)
  })

  it('false en otro entorno', async () => {
    const network = await offeredOnce()
    expect(network.wasOffered(OTHER, `${HOST}:443`, FP)).toBe(false)
  })

  it('false si untrusted() no se ha llamado: observar no es ofrecer', async () => {
    const network = build()
    const proc = await verifierOf(network, ENV)
    verify(proc, { errorCode: -202 })
    network.tlsFailure(ENV, `${HOST}:443`)
    expect(network.wasOffered(ENV, `${HOST}:443`, FP)).toBe(false)
  })

  it('false después de clearFailures (empieza otra prueba)', async () => {
    const network = await offeredOnce()
    network.clearFailures(ENV)
    expect(network.wasOffered(ENV, `${HOST}:443`, FP)).toBe(false)
  })

  it('sigue true después de reset (fijar otra huella renueva la sesión)', async () => {
    const network = await offeredOnce()
    network.reset(ENV)
    expect(network.wasOffered(ENV, `${HOST}:443`, FP)).toBe(true)
  })

  it('cuenta la ÚLTIMA llamada a untrusted(): si ya no lo lista, deja de estar ofrecido', async () => {
    const network = await offeredOnce()
    network.clearFailures(ENV)
    expect(network.untrusted(ENV)).toEqual([])
    expect(network.wasOffered(ENV, `${HOST}:443`, FP)).toBe(false)
  })

  it('si la URL del entorno cambia a otro host, lo ofrecido caduca; si vuelve, revive', async () => {
    const network = await offeredOnce()
    expect(network.wasOffered(ENV, `${HOST}:443`, FP)).toBe(true)

    hosts = ['otro.example']
    expect(network.wasOffered(ENV, `${HOST}:443`, FP)).toBe(false)

    hosts = [HOST]
    expect(network.wasOffered(ENV, `${HOST}:443`, FP)).toBe(true)
  })

  it('basta con que el host siga en alguna de las URL (clásica o de plataforma)', async () => {
    const network = await offeredOnce()
    hosts = ['plataforma.example', HOST]
    expect(network.wasOffered(ENV, `${HOST}:443`, FP)).toBe(true)
  })

  it('el puerto no cuenta para ese control (environmentHosts son nombres sin puerto)', async () => {
    const network = await offeredOnce(`${HOST}:9443`)
    hosts = [HOST]
    expect(network.wasOffered(ENV, `${HOST}:9443`, FP)).toBe(true)
  })

  it('si environmentHosts lanza (entorno borrado), nunca da true', async () => {
    const network = createEnvironmentNetwork({
      certificateLevel: () => level,
      environmentHosts: () => {
        throw new Error('NOT_FOUND')
      },
      pins: { list: () => [], pin: () => undefined, unpin: () => undefined, forHost: () => [] }
    })
    // Puede lanzar (el handler ya da NOT_FOUND antes con getEnvironment) o dar false.
    let result: boolean | 'lanza'
    try {
      result = network.wasOffered(ENV, `${HOST}:443`, FP)
    } catch {
      result = 'lanza'
    }
    expect(result).not.toBe(true)
  })

  describe('P3-7: el host del SSO también se puede fijar', () => {
    const SSO = 'sso.example'

    /** Red con ssoHost; el verificador rechaza el certificado del SSO y untrusted() lo ofrece. */
    async function ssoOffered(
      ssoHost: () => string | null
    ): Promise<ReturnType<typeof createEnvironmentNetwork>> {
      const network = createEnvironmentNetwork({
        certificateLevel: () => level,
        environmentHosts: () => hosts,
        ssoHost,
        pins: { list: () => pins, pin: () => undefined, unpin: () => undefined, forHost: () => [] }
      })
      const proc = await verifierOf(network, ENV)
      verify(proc, { hostname: SSO, errorCode: -202 })
      expect(network.tlsFailure(ENV, `${SSO}:443`)).toBe('untrusted')
      expect(network.untrusted(ENV)).toEqual([
        { host: `${SSO}:443`, fingerprint: FP, reason: 'untrusted', previousFingerprint: null }
      ])
      return network
    }

    it('con ssoHost = el del SSO → wasOffered true', async () => {
      const network = await ssoOffered(() => SSO)
      expect(network.wasOffered(ENV, `${SSO}:443`, FP)).toBe(true)
    })

    it('con ssoHost null (sin OAuth) → false', async () => {
      const network = await ssoOffered(() => null)
      expect(network.wasOffered(ENV, `${SSO}:443`, FP)).toBe(false)
    })

    it('con ssoHost de otro host (el SSO ha cambiado) → false', async () => {
      const network = await ssoOffered(() => 'otro-sso.example')
      expect(network.wasOffered(ENV, `${SSO}:443`, FP)).toBe(false)
    })

    it('sin la dep ssoHost (opcional), el SSO no se puede fijar', async () => {
      const network = build()
      const proc = await verifierOf(network, ENV)
      verify(proc, { hostname: SSO, errorCode: -202 })
      network.tlsFailure(ENV, `${SSO}:443`)
      network.untrusted(ENV)
      expect(network.wasOffered(ENV, `${SSO}:443`, FP)).toBe(false)
    })

    /** Verificador de una red con API en api.example, SSO en sso.example y los pins actuales. */
    async function verifierWithSso(): Promise<VerifyProc> {
      const network = createEnvironmentNetwork({
        certificateLevel: () => level,
        environmentHosts: () => ['api.example'],
        ssoHost: () => SSO,
        pins: { list: () => pins, pin: () => undefined, unpin: () => undefined, forHost: () => [] }
      })
      return verifierOf(network, ENV)
    }

    it('garantía 1: el pin del SSO solo vale para el SSO (la API sin pin propio → Chromium)', async () => {
      level = 'pinned'
      pins = [{ host: `${SSO}:443`, fingerprint: FP }]
      const proc = await verifierWithSso()
      // La API presenta justo la huella fijada para el SSO: no se acepta por eso.
      expect(verify(proc, { hostname: 'api.example', errorCode: -202 })).toEqual([USE_CHROMIUM])
      expect(
        verify(proc, {
          hostname: 'api.example',
          errorCode: -202,
          certificate: { fingerprint: OTHER_FP }
        })
      ).toEqual([USE_CHROMIUM])
      // El SSO con su huella sí.
      expect(verify(proc, { hostname: SSO, errorCode: -202 })).toEqual([ACCEPT])
    })

    it('garantía 1: con un pin propio de la API distinto, la huella del SSO no la salva → REJECT', async () => {
      level = 'pinned'
      pins = [
        { host: `${SSO}:443`, fingerprint: FP },
        { host: 'api.example:443', fingerprint: OTHER_FP }
      ]
      const proc = await verifierWithSso()
      expect(verify(proc, { hostname: 'api.example' })).toEqual([REJECT])
      expect(
        verify(proc, { hostname: 'api.example', certificate: { fingerprint: OTHER_FP } })
      ).toEqual([ACCEPT])
    })

    it("garantía 2: con 'ignore', el SSO sin pin → Chromium; con un pin que no coincide → REJECT", async () => {
      level = 'ignore'
      pins = []
      let proc = await verifierWithSso()
      expect(verify(proc, { hostname: SSO, errorCode: -202 })).toEqual([USE_CHROMIUM])
      // La API (del entorno) sí se ignora.
      expect(verify(proc, { hostname: 'api.example', errorCode: -202 })).toEqual([ACCEPT])

      pins = [{ host: `${SSO}:443`, fingerprint: OTHER_FP }]
      proc = await verifierWithSso()
      expect(verify(proc, { hostname: SSO, errorCode: -202 })).toEqual([REJECT])
      // Y con su pin correcto, aceptado.
      expect(
        verify(proc, { hostname: SSO, errorCode: -202, certificate: { fingerprint: OTHER_FP } })
      ).toEqual([ACCEPT])
    })

    it('garantía 3: la oferta se compara con el ssoHost del momento de fijar, no con el de la prueba', async () => {
      let current: string | null = SSO
      const network = await ssoOffered(() => current)
      expect(network.wasOffered(ENV, `${SSO}:443`, FP)).toBe(true)
      current = 'sso-b.example'
      expect(network.wasOffered(ENV, `${SSO}:443`, FP)).toBe(false)
      current = null
      expect(network.wasOffered(ENV, `${SSO}:443`, FP)).toBe(false)
      current = SSO
      expect(network.wasOffered(ENV, `${SSO}:443`, FP)).toBe(true)
    })

    it("el nivel 'ignore' NO se aplica al SSO: su certificado no fiable sigue rechazándose", async () => {
      level = 'ignore'
      const network = createEnvironmentNetwork({
        certificateLevel: () => level,
        environmentHosts: () => [HOST],
        ssoHost: () => SSO,
        pins: { list: () => [], pin: () => undefined, unpin: () => undefined, forHost: () => [] }
      })
      const proc = await verifierOf(network, ENV)
      expect(verify(proc, { hostname: SSO, errorCode: -202 })).toEqual([USE_CHROMIUM])
      expect(verify(proc, { hostname: HOST, errorCode: -202 })).toEqual([ACCEPT])
    })
  })

  it('con huella fijada distinta (mismatch), lo ofrecido es la huella NUEVA', async () => {
    level = 'pinned'
    pins = [{ host: `${HOST}:443`, fingerprint: FP }]
    const network = build()
    const proc = await verifierOf(network, ENV)
    verify(proc, { certificate: { fingerprint: OTHER_FP } })
    network.tlsFailure(ENV, `${HOST}:443`)
    network.untrusted(ENV)
    expect(network.wasOffered(ENV, `${HOST}:443`, OTHER_FP)).toBe(true)
    expect(network.wasOffered(ENV, `${HOST}:443`, FP)).toBe(false)
  })
})

describe('0079: la primera petición a cada host de cada sesión va sola', () => {
  /** Respuestas que el test suelta a mano, en orden de llegada a la red. */
  function manualFetch(partition: string): {
    urls: string[]
    resolve(index: number): void
    reject(index: number): void
  } {
    const urls: string[] = []
    const settlers: { resolve(): void; reject(): void }[] = []
    fake.fetches.get(partition)?.mockImplementation(
      (input: unknown) =>
        new Promise<Response>((resolve, reject) => {
          urls.push(String(input))
          settlers.push({
            resolve: () => resolve(new Response('{}')),
            reject: () => reject(new Error('net::ERR_CERT_AUTHORITY_INVALID'))
          })
        })
    )
    return {
      urls,
      resolve: (index) => settlers[index]?.resolve(),
      reject: (index) => settlers[index]?.reject()
    }
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  /** Abre la sesión sin pedir nada todavía al host de la prueba. */
  async function openSession(
    network: ReturnType<typeof createEnvironmentNetwork>
  ): Promise<string> {
    await network.fetchFor(ENV)('https://otro.example/')
    return `env-${ENV}-0`
  }

  it('las demás esperan a que acabe la primera; si entra, salen todas a la vez', async () => {
    const network = build()
    const red = manualFetch(await openSession(network))
    const fetchEnv = network.fetchFor(ENV)
    const first = fetchEnv(`https://${HOST}/a`)
    const second = fetchEnv(`https://${HOST}/b`)
    const third = fetchEnv(`https://${HOST}/c`)
    await settle()
    expect(red.urls).toEqual([`https://${HOST}/a`])
    red.resolve(0)
    await first
    await settle()
    expect(red.urls).toEqual([`https://${HOST}/a`, `https://${HOST}/b`, `https://${HOST}/c`])
    red.resolve(1)
    red.resolve(2)
    await Promise.all([second, third])
    // Ya entró una: la siguiente no espera a nadie.
    const fourth = fetchEnv(`https://${HOST}/d`)
    const fifth = fetchEnv(`https://${HOST}/e`)
    await settle()
    expect(red.urls).toHaveLength(5)
    red.resolve(3)
    red.resolve(4)
    await Promise.all([fourth, fifth])
  })

  it('si la primera falla, su error es el suyo y la siguiente vuelve a ir sola (sin reintentos)', async () => {
    const network = build()
    const red = manualFetch(await openSession(network))
    const fetchEnv = network.fetchFor(ENV)
    const first = fetchEnv(`https://${HOST}/a`)
    const second = fetchEnv(`https://${HOST}/b`)
    const third = fetchEnv(`https://${HOST}/c`)
    await settle()
    red.reject(0)
    await expect(first).rejects.toThrow('ERR_CERT_AUTHORITY_INVALID')
    await settle()
    expect(red.urls).toEqual([`https://${HOST}/a`, `https://${HOST}/b`])
    red.reject(1)
    await expect(second).rejects.toThrow('ERR_CERT_AUTHORITY_INVALID')
    await settle()
    expect(red.urls).toEqual([`https://${HOST}/a`, `https://${HOST}/b`, `https://${HOST}/c`])
    red.resolve(2)
    await third
    expect(red.urls).toHaveLength(3)
  })

  it('cada host, con su puerto, va por su cuenta', async () => {
    const network = build()
    const red = manualFetch(await openSession(network))
    const fetchEnv = network.fetchFor(ENV)
    void fetchEnv(`https://${HOST}/a`)
    void fetchEnv(`https://${HOST}:8443/a`)
    void fetchEnv(`https://sso.example/token`)
    void fetchEnv(`https://${HOST}/b`)
    await settle()
    expect(red.urls).toEqual([
      `https://${HOST}/a`,
      `https://${HOST}:8443/a`,
      `https://sso.example/token`
    ])
  })

  it('una sesión nueva (reset) vuelve a empezar: su primera petición va sola', async () => {
    const network = build()
    await network.fetchFor(ENV)(`https://${HOST}/a`)
    network.reset(ENV)
    await network.fetchFor(ENV)('https://otro.example/')
    const red = manualFetch(`env-${ENV}-1`)
    const fetchEnv = network.fetchFor(ENV)
    void fetchEnv(`https://${HOST}/a`)
    void fetchEnv(`https://${HOST}/b`)
    await settle()
    expect(red.urls).toEqual([`https://${HOST}/a`])
  })

  it('una petición que espera y se aborta sale con el motivo del aborto, sin llegar a la red', async () => {
    const network = build()
    const red = manualFetch(await openSession(network))
    const fetchEnv = network.fetchFor(ENV)
    const first = fetchEnv(`https://${HOST}/a`)
    const controller = new AbortController()
    const second = fetchEnv(`https://${HOST}/b`, { signal: controller.signal })
    const reason = new Error('tiempo agotado')
    controller.abort(reason)
    await expect(second).rejects.toBe(reason)
    const aborted = new AbortController()
    aborted.abort(reason)
    await expect(fetchEnv(`https://${HOST}/c`, { signal: aborted.signal })).rejects.toBe(reason)
    red.resolve(0)
    await first
    await settle()
    expect(red.urls).toEqual([`https://${HOST}/a`])
  })

  it('una petición que espera con una señal sin abortar sigue cuando acaba la primera', async () => {
    const network = build()
    const red = manualFetch(await openSession(network))
    const fetchEnv = network.fetchFor(ENV)
    const first = fetchEnv(`https://${HOST}/a`)
    const second = fetchEnv(`https://${HOST}/b`, { signal: new AbortController().signal })
    await settle()
    red.resolve(0)
    await first
    await settle()
    red.resolve(1)
    await second
    expect(red.urls).toEqual([`https://${HOST}/a`, `https://${HOST}/b`])
  })

  it('con un Request, el host sale de su URL y a la red llega el mismo Request', async () => {
    const network = build()
    const partition = await openSession(network)
    const request = new Request(`https://${HOST}/a`)
    await network.fetchFor(ENV)(request)
    expect(fake.fetches.get(partition)).toHaveBeenLastCalledWith(request, undefined)
  })
})

describe('0095: fila para los hosts con huella fijada', () => {
  /** Respuestas que el test suelta a mano, en orden de llegada a la red. */
  function heldFetch(partition: string): { urls: string[]; resolve(index: number): void } {
    const urls: string[] = []
    const settlers: (() => void)[] = []
    fake.fetches.get(partition)?.mockImplementation(
      (input: unknown) =>
        new Promise<Response>((resolve) => {
          urls.push(String(input))
          settlers.push(() => resolve(new Response('{}')))
        })
    )
    return { urls, resolve: (index) => settlers[index]?.() }
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  }

  /**
   * Abre la sesión (con una petición a otro host), retiene la red y hace que la primera petición
   * al host de la prueba acabe bien.
   */
  async function afterFirstOk(network: ReturnType<typeof createEnvironmentNetwork>): Promise<{
    urls: string[]
    resolve(index: number): void
    fetchEnv: ReturnType<ReturnType<typeof createEnvironmentNetwork>['fetchFor']>
  }> {
    await network.fetchFor(ENV)('https://otro.example/')
    const red = heldFetch(`env-${ENV}-0`)
    const fetchEnv = network.fetchFor(ENV)
    const first = fetchEnv(`https://${HOST}/primera`)
    await settle()
    expect(red.urls).toEqual([`https://${HOST}/primera`])
    red.resolve(0)
    await first
    return { ...red, fetchEnv }
  }

  describe('CA3 (0095): sin huella fijada para el host, las siguientes van a la vez', () => {
    const cases: [string, CertificateLevel, () => CertificatePin[]][] = [
      ["'sistema' sin huellas", 'system', () => []],
      [
        "'sistema' aunque el host tenga una huella guardada",
        'system',
        () => [{ host: `${HOST}:443`, fingerprint: FP }]
      ],
      [
        "'fijada' con huella solo para otro host",
        'pinned',
        () => [{ host: 'otro-host.example.invalid:443', fingerprint: FP }]
      ],
      ["'fijada' sin ninguna huella", 'pinned', () => []],
      ["'ignorar' en un host del entorno", 'ignore', () => []]
    ]

    for (const [name, caseLevel, casePins] of cases) {
      it(`CA3 (0095): ${name}: tras la primera que entra, las dos siguientes llegan juntas a la red`, async () => {
        level = caseLevel
        pins = casePins()
        const network = build()
        const red = await afterFirstOk(network)
        const second = red.fetchEnv(`https://${HOST}/b`)
        const third = red.fetchEnv(`https://${HOST}/c`)
        await settle()
        expect(red.urls).toEqual([
          `https://${HOST}/primera`,
          `https://${HOST}/b`,
          `https://${HOST}/c`
        ])
        red.resolve(1)
        red.resolve(2)
        await Promise.all([second, third])
      })
    }
  })

  describe('CA4 (0095): en la fila de un host con huella fijada, cancelar no espera ni bloquea', () => {
    beforeEach(() => {
      level = 'pinned'
      pins = [{ host: `${HOST}:443`, fingerprint: FP }]
    })

    it('CA4 (0095): con huella fijada, las peticiones van de una en una también después de la primera', async () => {
      const network = build()
      const red = await afterFirstOk(network)
      const b = red.fetchEnv(`https://${HOST}/b`)
      const c = red.fetchEnv(`https://${HOST}/c`)
      await settle()
      expect(red.urls).toEqual([`https://${HOST}/primera`, `https://${HOST}/b`])
      red.resolve(1)
      await b
      await settle()
      expect(red.urls).toEqual([
        `https://${HOST}/primera`,
        `https://${HOST}/b`,
        `https://${HOST}/c`
      ])
      red.resolve(2)
      await c
    })

    const cancellations: [string, () => Error][] = [
      ['se cancela', () => new DOMException('cancelada', 'AbortError')],
      ['agota su plazo', () => new DOMException('plazo agotado', 'TimeoutError')]
    ]

    for (const [name, makeReason] of cancellations) {
      it(`CA4 (0095): una petición que espera y ${name} sale con su error sin esperar a la de delante, y la de detrás sigue`, async () => {
        const network = build()
        const red = await afterFirstOk(network)
        const ahead = red.fetchEnv(`https://${HOST}/delante`)
        const controller = new AbortController()
        const waiting = red.fetchEnv(`https://${HOST}/espera`, { signal: controller.signal })
        const behind = red.fetchEnv(`https://${HOST}/detras`)
        await settle()
        expect(red.urls).toEqual([`https://${HOST}/primera`, `https://${HOST}/delante`])

        // La de delante sigue en la red: la que espera sale ya, con el motivo de su señal.
        const reason = makeReason()
        controller.abort(reason)
        await expect(waiting).rejects.toBe(reason)
        expect(red.urls).toEqual([`https://${HOST}/primera`, `https://${HOST}/delante`])

        // Al acabar la de delante, pasa la de detrás; la cancelada nunca llega a la red.
        red.resolve(1)
        await ahead
        await settle()
        expect(red.urls).toEqual([
          `https://${HOST}/primera`,
          `https://${HOST}/delante`,
          `https://${HOST}/detras`
        ])
        red.resolve(2)
        await behind
      })
    }
  })
})

describe('0095 (developer): el SSO con huella también va en fila', () => {
  const SSO = 'sso.example.invalid'

  /** Dos peticiones al SSO tras una primera que entra: cuántas llegan a la red antes de soltar. */
  async function concurrentAfterFirst(
    network: ReturnType<typeof createEnvironmentNetwork>
  ): Promise<string[]> {
    await network.fetchFor(ENV)('https://otro.example/')
    const urls: string[] = []
    const settlers: (() => void)[] = []
    fake.fetches.get(`env-${ENV}-0`)?.mockImplementation(
      (input: unknown) =>
        new Promise<Response>((resolve) => {
          urls.push(String(input))
          settlers.push(() => resolve(new Response('{}')))
        })
    )
    const tick = async (): Promise<void> => {
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const fetchEnv = network.fetchFor(ENV)
    const first = fetchEnv(`https://${SSO}/token`)
    await tick()
    settlers[0]?.()
    await first
    const b = fetchEnv(`https://${SSO}/b`)
    const c = fetchEnv(`https://${SSO}/c`)
    await tick()
    const seen = [...urls]
    while (settlers.length < 3) {
      settlers.at(-1)?.()
      await tick()
    }
    settlers.forEach((settle) => settle())
    await Promise.all([b, c])
    return seen
  }

  it("con 'ignorar' (que nunca vale para el SSO) y huella fijada para el SSO, de una en una", async () => {
    level = 'ignore'
    pins = [{ host: `${SSO}:443`, fingerprint: FP }]
    expect(await concurrentAfterFirst(build())).toEqual([
      `https://${SSO}/token`,
      `https://${SSO}/b`
    ])
  })

  it("con 'fijada' y huella fijada para el SSO, de una en una", async () => {
    level = 'pinned'
    pins = [{ host: `${SSO}:443`, fingerprint: FP }]
    expect(await concurrentAfterFirst(build())).toEqual([
      `https://${SSO}/token`,
      `https://${SSO}/b`
    ])
  })

  it("con 'ignorar' y el SSO sin huella, a la vez como hoy", async () => {
    level = 'ignore'
    pins = []
    expect(await concurrentAfterFirst(build())).toEqual([
      `https://${SSO}/token`,
      `https://${SSO}/b`,
      `https://${SSO}/c`
    ])
  })

  it('si no se pueden leer los datos del verificador, en fila', async () => {
    level = 'pinned'
    pins = [{ host: `${SSO}:443`, fingerprint: FP }]
    const network = build()
    await network.fetchFor(ENV)('https://otro.example/')
    throwOnLevel = new Error('entorno borrado')
    const urls: string[] = []
    const settlers: (() => void)[] = []
    fake.fetches.get(`env-${ENV}-0`)?.mockImplementation(
      (input: unknown) =>
        new Promise<Response>((resolve) => {
          urls.push(String(input))
          settlers.push(() => resolve(new Response('{}')))
        })
    )
    const fetchEnv = network.fetchFor(ENV)
    const a = fetchEnv(`https://${SSO}/a`)
    await new Promise((resolve) => setTimeout(resolve, 0))
    settlers[0]?.()
    await a
    const b = fetchEnv(`https://${SSO}/b`)
    const c = fetchEnv(`https://${SSO}/c`)
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    expect(urls).toEqual([`https://${SSO}/a`, `https://${SSO}/b`])
    settlers[1]?.()
    await b
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    settlers[2]?.()
    await c
  })
})
