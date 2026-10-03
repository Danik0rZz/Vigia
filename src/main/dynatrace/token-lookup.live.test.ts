import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from './errors'

/**
 * PRUEBA EN VIVO: POST /api/v2/apiTokens/lookup (la única petición no GET que
 * permite la guarda). Sirve para saber qué scopes tiene el token y qué bloques
 * de la API v2 se pueden explorar.
 *
 * El informe (live-reports/token-lookup.json, ignorado) lleva SOLO la forma de
 * la respuesta (campo → tipo) y los nombres de los scopes, que son genéricos.
 * Nunca el nombre, el id, el propietario ni las fechas del token.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)

/** Tipo de un valor JSON, sin el valor. */
function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    const inner = [...new Set(value.map(typeOf))].sort()
    return `array<${inner.join('|') || 'vacío'}>`
  }
  if (typeof value === 'object') return 'object'
  return typeof value
}

/** Forma de un objeto: cada campo con su tipo (un nivel; los objetos anidados, aparte). */
function shapeOf(value: unknown, prefix = ''): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const shape: Record<string, string> = {}
  for (const [key, child] of Object.entries(value)) {
    shape[`${prefix}${key}`] = typeOf(child)
    if (typeOf(child) === 'object') Object.assign(shape, shapeOf(child, `${prefix}${key}.`))
  }
  return shape
}

/** Bloques de la exploración y el scope clásico que necesita cada uno. */
const BLOCKS: Record<string, string> = {
  'a) Problems': 'problems.read',
  'b) Entities y entityTypes': 'entities.read',
  'c) Metrics': 'metrics.read',
  'd) SLOs': 'slo.read',
  'e) Events y eventTypes': 'events.read',
  'f) Settings 2.0': 'settings.read'
}

describe.skipIf(live === null)('apiTokens/lookup', () => {
  it('describe el token: forma de la respuesta y scopes', async () => {
    if (live === null || env === null) return
    const started = Date.now()
    let body: unknown
    try {
      body = await live.client.dtRequest({
        envId: 'live',
        api: 'classic',
        method: 'POST',
        path: '/apiTokens/lookup',
        body: { token: env.token },
        schema: z.unknown(),
        auth: 'classicToken'
      })
    } catch (error) {
      throw new Error(`lookup: ${error instanceof DtError ? error.code : 'NO_DT_ERROR'}`)
    }
    const elapsedMs = Date.now() - started

    const scopes = z.object({ scopes: z.array(z.string()) }).safeParse(body)
    expect(scopes.success, 'la respuesta trae scopes: string[]').toBe(true)
    const granted = scopes.success ? [...new Set(scopes.data.scopes)].sort() : []

    const report = {
      shape: shapeOf(body),
      elapsedMs,
      scopes: granted,
      readScopes: granted.filter((scope) => /\.read$|^read/i.test(scope)),
      writeLikeScopes: granted.filter((scope) => /write|ingest|create|delete|manage/i.test(scope)),
      blocks: Object.fromEntries(
        Object.entries(BLOCKS).map(([block, scope]) => [block, granted.includes(scope)])
      ),
      tokenEnLog: live.logged.some((line) => line.includes(env.token))
    }
    expect(report.tokenEnLog, 'el token no aparece en el log').toBe(false)

    mkdirSync('live-reports', { recursive: true })
    writeFileSync(join('live-reports', 'token-lookup.json'), `${JSON.stringify(report, null, 2)}\n`)
  })
})
