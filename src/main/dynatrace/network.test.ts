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
