import { matchRoutes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { entityPath } from './entity-route'
import { buildRoutes } from './router'

/**
 * Ficha 0003: ruta de la página de análisis de una entidad,
 * `#/entities/:entityType/:entityId`, con los dos segmentos codificados con
 * `encodeURIComponent` (los tipos personalizados llevan `:`). La ida y vuelta se
 * comprueba con el árbol de rutas real: lo que recibe la página es lo de partida.
 */

/** Params de la ruta de entidad que resuelve el router para `path` (o null). */
function entityParams(path: string): Record<string, string | undefined> | null {
  const matches = matchRoutes(buildRoutes({ errorTrigger: false }), path) ?? []
  const params = matches.at(-1)?.params ?? {}
  // El 404 (path '*') no tiene estos dos params.
  if (!('entityType' in params) || !('entityId' in params)) return null
  return { entityType: params['entityType'], entityId: params['entityId'] }
}

const CASES = [
  { type: 'HOST', id: 'HOST-0123456789ABCDEF' },
  { type: 'algo:otro', id: 'ALGO-1' },
  { type: 'custom:tipo:con:varios', id: 'id/con barra y espacios' },
  { type: 'SERVICE', id: 'a%2Fb %25 #hash ?q=1&x=2 áéñ' },
  { type: 'PROCESS_GROUP_INSTANCE', id: 'PGI-1:2+3' }
] as const

describe('CA5 (0003): la ruta codifica y decodifica bien el tipo y el id', () => {
  it('cada segmento va con encodeURIComponent', () => {
    expect(entityPath('HOST', 'HOST-1')).toBe('/entities/HOST/HOST-1')
    expect(entityPath('algo:otro', 'a/b c')).toBe('/entities/algo%3Aotro/a%2Fb%20c')
  })

  it.each(CASES)('ida y vuelta: $type / $id', ({ type, id }) => {
    const path = entityPath(type, id)
    expect(path.startsWith('/entities/')).toBe(true)
    // Dos segmentos tras /entities: ni el tipo ni el id parten la ruta.
    expect(path.split('/')).toHaveLength(4)
    expect(entityParams(path)).toEqual({ entityType: type, entityId: id })
  })

  it('es una página dentro de la app, no el 404', () => {
    expect(entityParams(entityPath('HOST', 'HOST-1'))).not.toBeNull()
  })
})
