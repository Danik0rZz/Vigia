import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { CertificatePin } from '@shared/dynatrace'
import type { CertificateLevel } from '@shared/tenants'
import { createDtClient } from './client'
import { DtError } from './errors'

/**
 * Ficha 0079: dos peticiones a la vez al mismo entorno recién creado, con el cliente y la sesión de
 * red por entorno reales y un Chromium simulado. Electron se sustituye por un `session.fromPartition`
 * falso cuyo `fetch` hace lo que hace Chromium con `setCertificateVerifyProc`: pregunta al
 * verificador de la partición por el certificado del host y, según lo que responda, deja pasar la
 * petición (0), la corta con `net::ERR_FAILED` (-2) o aplica su propia verificación (-3), que con un
 * certificado propio falla con `net::ERR_CERT_AUTHORITY_INVALID`.
 *
 * Las dos peticiones se lanzan a la vez, pero el montaje no exige que estén en la red a la vez: con
 * el arreglo de la ficha, la primera petición a cada host va sola y las demás esperan a que acabe.
 * Chromium simulado responde en cuanto le llega cada petición, sin tiempos ni esperas.
 */

type VerifyRequest = {
  hostname: string
  certificate: { fingerprint: string }
  verificationResult: string
  errorCode: number
}
type VerifyProc = (request: VerifyRequest, callback: (result: number) => void) => void

const ACCEPT = 0
const REJECT = -2
/** Código de Chromium de un certificado de una CA que no conoce (autofirmado). */
const ERR_CERT_AUTHORITY_INVALID = -202

const fake = vi.hoisted(() => ({
  partitions: [] as string[],
  procs: new Map<string, unknown>(),
  /** Huella del certificado que presenta el servidor. */
  fingerprint: '',
  /** Peticiones que han llegado a la red (una por intento HTTP). */
  fetches: 0,
  /** Veces que Chromium ha preguntado al verificador. */
  verifications: 0
}))

vi.mock('electron', () => ({
  session: {
    fromPartition(partition: string) {
      fake.partitions.push(partition)
      return {
        setCertificateVerifyProc(fn: unknown) {
          fake.procs.set(partition, fn)
        },
        async fetch(input: string) {
          fake.fetches += 1
          const proc = fake.procs.get(partition) as VerifyProc | undefined
          if (proc === undefined) throw new Error('net::ERR_CERT_AUTHORITY_INVALID')
          fake.verifications += 1
          const result = await new Promise<number>((resolve) =>
            proc(
              {
                hostname: new URL(input).hostname,
                certificate: { fingerprint: fake.fingerprint },
                verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID',
                errorCode: ERR_CERT_AUTHORITY_INVALID
              },
              resolve
            )
          )
          if (result === ACCEPT) return Response.json({ totalCount: 0, problems: [] })
          if (result === REJECT) throw new Error('net::ERR_FAILED')
          // -3: decide Chromium, y no confía en un certificado propio.
          throw new Error('net::ERR_CERT_AUTHORITY_INVALID')
        }
      }
    }
  }
}))

const { createEnvironmentNetwork } = await import('./network')

const ENV = 'env-nuevo'
const HOST = 'abc12345.live.dynatrace.example'
const FP = 'AA:BB:CC'
const OTHER_FP = 'DD:EE:FF'
const CLASSIC_TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOCLASICO'.padEnd(64, 'X')}`
const T0 = new Date('2026-10-11T10:00:00.000Z')

let level: CertificateLevel
let pins: CertificatePin[]

beforeEach(() => {
  fake.partitions.length = 0
  fake.procs.clear()
  fake.fetches = 0
  fake.verifications = 0
  fake.fingerprint = FP
  level = 'system'
  pins = []
})

/** Cliente real sobre la red por entorno real, como lo monta `services.ts`. */
function build(): ReturnType<typeof createDtClient> {
  const network = createEnvironmentNetwork({
    certificateLevel: () => level,
    environmentHosts: () => [HOST],
    ssoHost: () => null,
    pins: { list: () => pins, pin: () => undefined, unpin: () => undefined, forHost: () => [] }
  })
  return createDtClient({
    fetchFor: (envId: string) => network.fetchFor(envId),
    getEnvironment: () => ({ classicApiUrl: `https://${HOST}`, platformUrl: null }),
    readSecret: (_envId: string, kind: string) => (kind === 'classicToken' ? CLASSIC_TOKEN : null),
    oauth: {
      getToken: vi.fn(async () => {
        throw new DtError('NO_CREDENTIAL', 'Sin OAuth en esta prueba')
      }),
      invalidate: vi.fn(),
      expiresAt: vi.fn(() => null)
    },
    sleep: vi.fn(async () => undefined),
    now: () => T0,
    random: () => 0.5,
    logger: { warn: vi.fn(), error: vi.fn() },
    tlsFailure: (envId: string, host: string) => network.tlsFailure(envId, host)
  } as unknown as Parameters<typeof createDtClient>[0])
}

/**
 * Lanza las dos peticiones a la vez (problemas y SLOs, en el mismo tick y sin esperar a ninguna) y
 * espera a que acaben las dos, vayan juntas a la red o una detrás de otra.
 */
async function twoAtOnce(): Promise<PromiseSettledResult<unknown>[]> {
  const client = build()
  const schema = z.object({}).passthrough()
  return Promise.allSettled([
    client.dtRequest({ envId: ENV, api: 'classic', path: '/problems', schema }),
    client.dtRequest({ envId: ENV, api: 'classic', path: '/slo', schema })
  ])
}

/** Código de DtError de cada petición, o «entra» si no falló. */
function codes(results: PromiseSettledResult<unknown>[]): string[] {
  return results.map((result) => {
    if (result.status === 'fulfilled') return 'entra'
    return result.reason instanceof DtError ? result.reason.code : String(result.reason)
  })
}

describe('CA4 (0079): dos peticiones a la vez a un entorno recién creado, con un rechazo real', () => {
  it("CA4 (0079): con 'sistema' y un certificado propio, las dos salen como TLS_UNTRUSTED", async () => {
    level = 'system'
    const results = await twoAtOnce()
    expect(codes(results)).toEqual(['TLS_UNTRUSTED', 'TLS_UNTRUSTED'])
    // Una sola sesión para el entorno: las dos peticiones van por la misma partición.
    expect(new Set(fake.partitions).size).toBe(1)
  })

  it("CA4 (0079): con 'fijada' y otra huella, las dos salen como TLS_PIN_MISMATCH", async () => {
    level = 'pinned'
    pins = [{ host: `${HOST}:443`, fingerprint: FP }]
    fake.fingerprint = OTHER_FP
    const results = await twoAtOnce()
    expect(codes(results)).toEqual(['TLS_PIN_MISMATCH', 'TLS_PIN_MISMATCH'])
  })

  it("CA4 (0079): con 'fijada' y nada fijado para el host, un certificado propio no deja entrar a ninguna", async () => {
    level = 'pinned'
    pins = []
    const results = await twoAtOnce()
    expect(codes(results)).toEqual(['TLS_UNTRUSTED', 'TLS_UNTRUSTED'])
  })

  it('CA4 (0079): el rechazo no se reintenta hasta que entre (una verificación por petición)', async () => {
    level = 'pinned'
    pins = [{ host: `${HOST}:443`, fingerprint: FP }]
    fake.fingerprint = OTHER_FP
    // Si el cliente reintentase, la petición nueva volvería a la red y se contaría aquí.
    const results = await twoAtOnce()
    expect(codes(results)).toEqual(['TLS_PIN_MISMATCH', 'TLS_PIN_MISMATCH'])
    expect(fake.fetches).toBe(2)
    expect(fake.verifications).toBe(2)
  })
})
