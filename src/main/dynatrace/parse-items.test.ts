import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseItems } from './parse-items'

/**
 * AUD-08: lista tolerante. Un elemento que no cumple el esquema se descarta y
 * se cuenta; de él solo se guardan las rutas de Zod (generalizadas), nunca
 * valores ni mensajes, porque pueden llevar datos del tenant.
 */

const item = z.object({
  id: z.string(),
  severityLevel: z.string(),
  affectedEntities: z.array(z.object({ entityId: z.object({ id: z.string() }) }))
})

const ok = (id: string): Record<string, unknown> => ({
  id,
  severityLevel: 'ERROR',
  affectedEntities: [{ entityId: { id: 'SERVICE-1' } }]
})

// Valor sensible inventado: no puede aparecer en lo que devuelve parseItems salvo en items.
const SENSITIVE = 'host-secreto-cliente.ejemplo.invalid'

describe('parseItems', () => {
  it('todos válidos: items completos, invalid 0 y sin rutas', () => {
    const result = parseItems(item, [ok('a'), ok('b')])
    expect(result).toEqual({ items: [ok('a'), ok('b')], invalid: 0, paths: [] })
  })

  it('lista vacía', () => {
    expect(parseItems(item, [])).toEqual({ items: [], invalid: 0, paths: [] })
  })

  it('mezcla: descarta los inválidos, los cuenta y conserva el orden de los válidos', () => {
    const result = parseItems(item, [ok('a'), { id: 1 }, ok('b'), null, 'texto', ok('c')])
    expect(result.items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(result.invalid).toBe(3)
  })

  it('rutas generalizadas: sin el índice del elemento y con los índices internos como []', () => {
    const result = parseItems(item, [
      ok('a'),
      { ...ok('x'), severityLevel: 42 },
      { ...ok('y'), affectedEntities: [{ entityId: { id: 'S-1' } }, { entityId: { id: 7 } }] }
    ])
    expect(result.invalid).toBe(2)
    expect([...result.paths].sort()).toEqual(['affectedEntities.[].entityId.id', 'severityLevel'])
    for (const path of result.paths) expect(path).not.toMatch(/\d/)
  })

  it('sin duplicados: la misma ruta en varios elementos sale una vez', () => {
    const result = parseItems(item, [
      { ...ok('x'), severityLevel: 1 },
      { ...ok('y'), severityLevel: 2 }
    ])
    expect(result.paths).toEqual(['severityLevel'])
    expect(result.invalid).toBe(2)
  })

  it('nunca valores ni mensajes: un valor sensible en un elemento inválido no sale en invalid ni en paths', () => {
    const bad = { id: SENSITIVE, severityLevel: SENSITIVE, affectedEntities: SENSITIVE }
    const result = parseItems(item, [bad, { id: 3, severityLevel: SENSITIVE }])
    const outside = JSON.stringify({ invalid: result.invalid, paths: result.paths })
    expect(outside).not.toContain(SENSITIVE)
    expect(outside).not.toMatch(/expected|received|invalid_type|Required/i)
    expect(result.items).toEqual([])
  })

  it('como mucho 20 rutas', () => {
    const wide = z.object(
      Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [
          `campo${String.fromCharCode(97 + (i % 26))}${i >= 26 ? 'x' : ''}`,
          z.string()
        ])
      )
    )
    const result = parseItems(wide, [{}])
    expect(result.invalid).toBe(1)
    expect(result.paths.length).toBeLessThanOrEqual(20)
    expect(new Set(result.paths).size).toBe(result.paths.length)
  })

  it('un elemento que no es un objeto da una ruta vacía o raíz, nunca su valor', () => {
    const result = parseItems(item, [SENSITIVE])
    expect(result.invalid).toBe(1)
    expect(JSON.stringify(result.paths)).not.toContain(SENSITIVE)
  })
})
