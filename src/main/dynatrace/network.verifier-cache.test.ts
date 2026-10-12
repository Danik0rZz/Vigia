import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { CertificatePin } from '@shared/dynatrace'
import type { CertificateLevel } from '@shared/tenants'
import { createDtClient } from './client'
import { DtError } from './errors'

/**
 * Ficha 0079, CA2: dos conexiones nuevas a la vez al mismo host pueden saltarse el verificador de la
 * app. Si la segunda llega mientras la primera espera la respuesta del verificador, Chromium le da
 * su propio resultado sin preguntar: con «ignorar» o con la huella fijada de un certificado propio,
 * la segunda falla aunque el verificador acepte; con «fijada» y otra huella, la segunda no debe
 * entrar. Por eso la primera petición a cada host de cada sesión va sola.
 *
 * El `session.fromPartition` falso se comporta así por partición, y el momento de la segunda
 * petición lo fija el test (sin tiempos): llega cuando la primera espera al verificador.
 */

type VerifyRequest = {
  hostname: string
  certificate: { fingerprint: string }
  verificationResult: string
  errorCode: number
}
type VerifyProc = (request: VerifyRequest, callback: (result: number) => void) => void

const OK = 0
const REJECT = -2
const USE_CHROMIUM = -3
/** Código de Chromium de un certificado de una CA que no conoce (autofirmado). */
const ERR_CERT_AUTHORITY_INVALID = -202

const fake = vi.hoisted(() => ({
  procs: new Map<string, unknown>(),
  /** Resultado final de cada host ya verificado, por partición. */
  decided: new Map<string, number>(),
  /** Resultado de Chromium de cada host cuya verificación espera al verificador, por partición. */
  waiting: new Map<string, number>(),
  /** Huella y resultado de Chromium del certificado que presenta el servidor. */
  fingerprint: '',
  chromiumError: 0,
  /** Conexiones que esperan la respuesta del verificador de la app. */
  atVerifier: [] as (() => void)[],
  /** Peticiones que han llegado a la red. */
  fetches: 0
}))

vi.mock('electron', () => ({
  session: {
    fromPartition(partition: string) {
      const key = (hostname: string): string => `${partition}|${hostname}|${fake.fingerprint}`
      /** Verificación de una conexión nueva: el resultado neto que ve la petición. */
      async function verifyConnection(hostname: string): Promise<number> {
        const decided = fake.decided.get(key(hostname))
        if (decided !== undefined) return decided
        // Otra conexión al mismo host espera al verificador: esta se lleva el resultado de
        // Chromium sin que se pregunte a la app (es lo que el arreglo tiene que evitar).
        const pending = fake.waiting.get(key(hostname))
        if (pending !== undefined) {
          fake.decided.set(key(hostname), pending)
          return pending
        }
        // Verificación de Chromium (asíncrona).
        await Promise.resolve()
        const chromium = fake.chromiumError
        fake.waiting.set(key(hostname), chromium)
        // Espera al verificador de la app: lo suelta el test.
        await new Promise<void>((resolve) => fake.atVerifier.push(resolve))
        const proc = fake.procs.get(partition) as VerifyProc | undefined
        if (proc === undefined) return chromium
        const answer = await new Promise<number>((resolve) =>
          proc(
            {
              hostname,
              certificate: { fingerprint: fake.fingerprint },
              verificationResult: chromium === OK ? 'net::OK' : 'net::ERR_CERT_AUTHORITY_INVALID',
              errorCode: chromium
            },
            resolve
          )
        )
        const result = answer === USE_CHROMIUM ? chromium : answer
        fake.waiting.delete(key(hostname))
        fake.decided.set(key(hostname), result)
        return result
      }
      return {
        setCertificateVerifyProc(fn: unknown) {
          fake.procs.set(partition, fn)
        },
        async fetch(input: string) {
          fake.fetches += 1
          const result = await verifyConnection(new URL(input).hostname)
          if (result === OK) return Response.json({ totalCount: 0, problems: [] })
          if (result === REJECT) throw new Error('net::ERR_FAILED')
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
  fake.procs.clear()
  fake.decided.clear()
  fake.waiting.clear()
  fake.atVerifier.length = 0
  fake.fetches = 0
  fake.fingerprint = FP
  fake.chromiumError = ERR_CERT_AUTHORITY_INVALID
  level = 'ignore'
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

/** Deja correr lo pendiente (microtareas y temporizadores a cero), sin esperar tiempo real. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Problemas y SLOs a la vez: la segunda se pide cuando la primera espera al verificador de la app.
 * Después se suelta todo lo que espere.
 */
async function secondInTheWindow(): Promise<string[]> {
  const client = build()
  const schema = z.object({}).passthrough()
  const first = client.dtRequest({ envId: ENV, api: 'classic', path: '/problems', schema })
  await vi.waitFor(() => expect(fake.atVerifier).toHaveLength(1))
  const second = client.dtRequest({ envId: ENV, api: 'classic', path: '/slo', schema })
  // Se recogen ya: la segunda puede fallar antes de soltar la primera.
  const results = Promise.allSettled([first, second])
  await settle()
  // Suelta las verificaciones pendientes, también las que lleguen al soltar las anteriores.
  const releaseAll = async (): Promise<void> => {
    while (fake.atVerifier.length > 0) {
      for (const release of fake.atVerifier.splice(0)) release()
      await settle()
    }
  }
  await releaseAll()
  return (await results).map((result) => {
    if (result.status === 'fulfilled') return 'entra'
    return result.reason instanceof DtError ? result.reason.code : String(result.reason)
  })
}

describe('CA2 (0079): la segunda conexión no se salta el verificador', () => {
  it("CA2 (0079): con 'ignorar' y un certificado propio, las dos peticiones entran", async () => {
    level = 'ignore'
    expect(await secondInTheWindow()).toEqual(['entra', 'entra'])
  })

  it("CA2 (0079): con 'fijada' y la huella fijada de un certificado propio, las dos entran", async () => {
    level = 'pinned'
    pins = [{ host: `${HOST}:443`, fingerprint: FP }]
    expect(await secondInTheWindow()).toEqual(['entra', 'entra'])
  })

  it("CA2 (0079): con 'fijada' y un certificado de CA pública con otra huella, no entra ninguna", async () => {
    level = 'pinned'
    pins = [{ host: `${HOST}:443`, fingerprint: FP }]
    fake.fingerprint = OTHER_FP
    fake.chromiumError = OK
    expect(await secondInTheWindow()).toEqual(['TLS_PIN_MISMATCH', 'TLS_PIN_MISMATCH'])
  })

  it("CA2 (0079): con 'sistema' y un certificado propio, las dos salen como TLS_UNTRUSTED", async () => {
    // Guarda: con «sistema» la segunda ya recibe el rechazo de Chromium; el arreglo no lo cambia.
    level = 'system'
    expect(await secondInTheWindow()).toEqual(['TLS_UNTRUSTED', 'TLS_UNTRUSTED'])
  })
})

/**
 * La sesión simulada olvida lo que decidió el verificador para cada host (como pasa en la real
 * pasado un tiempo): la siguiente conexión a ese host vuelve a ser nueva.
 */
function forgetDecisions(): void {
  fake.decided.clear()
}

/** Suelta las verificaciones pendientes, también las que lleguen al soltar las anteriores. */
async function releaseVerifier(): Promise<void> {
  while (fake.atVerifier.length > 0) {
    for (const release of fake.atVerifier.splice(0)) release()
    await settle()
  }
}

function outcome(result: PromiseSettledResult<unknown>): string {
  if (result.status === 'fulfilled') return 'entra'
  return result.reason instanceof DtError ? result.reason.code : String(result.reason)
}

/**
 * Una primera petición que entra; después la sesión olvida la decisión y se lanzan dos peticiones a
 * la vez al mismo host. Devuelve lo que sale de cada una de las dos.
 */
async function twoAfterForgetting(changeCertificate?: () => void): Promise<string[]> {
  const client = build()
  const schema = z.object({}).passthrough()
  const first = client.dtRequest({ envId: ENV, api: 'classic', path: '/problems', schema })
  await vi.waitFor(() => expect(fake.atVerifier).toHaveLength(1))
  await releaseVerifier()
  expect(outcome((await Promise.allSettled([first]))[0] as PromiseSettledResult<unknown>)).toBe(
    'entra'
  )

  forgetDecisions()
  changeCertificate?.()
  // La segunda se pide cuando la primera espera al verificador de la app (la ventana de la 0079).
  const a = client.dtRequest({ envId: ENV, api: 'classic', path: '/problems', schema })
  await vi.waitFor(() => expect(fake.atVerifier).toHaveLength(1))
  const b = client.dtRequest({ envId: ENV, api: 'classic', path: '/slo', schema })
  // Se recogen ya: la segunda puede fallar antes de soltar la primera.
  const results = Promise.allSettled([a, b])
  await settle()
  await releaseVerifier()
  return (await results).map(outcome)
}

describe('CA1 (0095): con huella fijada, la sesión que olvida la decisión no deja saltarse el verificador', () => {
  it("CA1 (0095): con 'fijada' y la huella fijada de un certificado propio, las dos entran", async () => {
    level = 'pinned'
    pins = [{ host: `${HOST}:443`, fingerprint: FP }]
    fake.chromiumError = ERR_CERT_AUTHORITY_INVALID
    // Sin la fila, la segunda se lleva el rechazo de Chromium sin preguntar a la app.
    expect(await twoAfterForgetting()).toEqual(['entra', 'entra'])
  })

  it("CA1 (0095): con 'fijada' y un certificado de CA pública con otra huella, no entra ninguna", async () => {
    level = 'pinned'
    pins = [{ host: `${HOST}:443`, fingerprint: FP }]
    // Sin la fila, la segunda se lleva el «sí» de Chromium y entra con una huella que no es la fijada.
    expect(
      await twoAfterForgetting(() => {
        fake.fingerprint = OTHER_FP
        fake.chromiumError = OK
      })
    ).toEqual(['TLS_PIN_MISMATCH', 'TLS_PIN_MISMATCH'])
  })
})
