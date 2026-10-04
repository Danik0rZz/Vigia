import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_EVIDENCE_SORT, EMPTY_EVIDENCE_FILTERS } from '@shared/problem-evidence'
import {
  EVIDENCE_TABLE_LIMIT,
  INITIAL_EVIDENCE_TABLE,
  evidenceTableKey,
  useEvidenceTableStore
} from './evidence-table'

/**
 * v0.10.0: estado de la tabla de evidencias por entorno y problema (filtros,
 * orden y filas desplegadas). En memoria, como mucho 20 problemas (LRU): volver
 * a uno vivo lo deja como estaba y uno nuevo empieza limpio.
 */

const store = (): ReturnType<typeof useEvidenceTableStore.getState> =>
  useEvidenceTableStore.getState()

const ENV_A = '11111111-1111-4111-8111-111111111111'
const ENV_B = '22222222-2222-4222-8222-222222222222'
const key = (problem: string, env = ENV_A): string => evidenceTableKey(env, problem)

beforeEach(() => {
  useEvidenceTableStore.setState({ tables: {}, order: [] })
})

describe('evidenceTableKey e INITIAL_EVIDENCE_TABLE', () => {
  it('la clave es envId:problemId', () => {
    expect(evidenceTableKey(ENV_A, 'p-1')).toBe(`${ENV_A}:p-1`)
  })

  it('el estado inicial: sin filtros, el orden por defecto y nada desplegado', () => {
    expect(INITIAL_EVIDENCE_TABLE).toEqual({
      filters: EMPTY_EVIDENCE_FILTERS,
      sort: DEFAULT_EVIDENCE_SORT,
      expanded: []
    })
    expect(EVIDENCE_TABLE_LIMIT).toBe(20)
  })
})

describe('useEvidenceTableStore', () => {
  it('un problema nuevo empieza en INITIAL (get no crea nada)', () => {
    expect(store().get(key('nuevo'))).toEqual(INITIAL_EVIDENCE_TABLE)
    expect(store().order).toEqual([])
    expect(store().tables).toEqual({})
  })

  it('touch crea con INITIAL y lo pone el más reciente', () => {
    store().touch(key('a'))
    store().touch(key('b'))
    expect(store().order).toEqual([key('a'), key('b')])
    expect(store().get(key('a'))).toEqual(INITIAL_EVIDENCE_TABLE)
    store().touch(key('a'))
    expect(store().order).toEqual([key('b'), key('a')])
  })

  it('update mezcla el patch, conserva lo demás y lo marca como el más reciente', () => {
    store().touch(key('a'))
    store().touch(key('b'))
    store().update(key('a'), {
      filters: { ...EMPTY_EVIDENCE_FILTERS, status: 'OPEN', text: 'cpu' }
    })
    expect(store().get(key('a'))).toEqual({
      filters: { ...EMPTY_EVIDENCE_FILTERS, status: 'OPEN', text: 'cpu' },
      sort: DEFAULT_EVIDENCE_SORT,
      expanded: []
    })
    expect(store().order.at(-1)).toBe(key('a'))
    store().update(key('a'), { sort: { key: 'title', direction: 'desc' } })
    expect(store().get(key('a')).filters.status).toBe('OPEN')
    expect(store().get(key('a')).sort).toEqual({ key: 'title', direction: 'desc' })
  })

  it('update de una clave que no existía la crea desde INITIAL', () => {
    store().update(key('x'), { expanded: ['e1'] })
    expect(store().get(key('x'))).toEqual({ ...INITIAL_EVIDENCE_TABLE, expanded: ['e1'] })
    expect(store().order).toEqual([key('x')])
  })

  it('volver a un problema que sigue en el store lo deja como estaba', () => {
    store().touch(key('a'))
    store().update(key('a'), {
      filters: { ...EMPTY_EVIDENCE_FILTERS, rootCauseOnly: true, tag: 'equipo:pagos' },
      sort: { key: 'start', direction: 'asc' },
      expanded: ['e7']
    })
    for (const other of ['b', 'c', 'd']) store().touch(key(other))
    store().touch(key('a'))
    expect(store().get(key('a'))).toEqual({
      filters: { ...EMPTY_EVIDENCE_FILTERS, rootCauseOnly: true, tag: 'equipo:pagos' },
      sort: { key: 'start', direction: 'asc' },
      expanded: ['e7']
    })
  })

  it('otro entorno con el mismo problemId es otra entrada', () => {
    store().update(key('p-1', ENV_A), { expanded: ['e1'] })
    expect(store().get(key('p-1', ENV_B))).toEqual(INITIAL_EVIDENCE_TABLE)
    store().update(key('p-1', ENV_B), { expanded: ['e9'] })
    expect(store().get(key('p-1', ENV_A)).expanded).toEqual(['e1'])
    expect(store().get(key('p-1', ENV_B)).expanded).toEqual(['e9'])
  })

  it('como mucho 20: el 21 expulsa al usado hace más tiempo, no al primero creado si se ha vuelto a tocar', () => {
    for (let i = 1; i <= 20; i += 1) store().update(key(`p${i}`), { expanded: [`e${i}`] })
    // p1 se vuelve a usar: el menos reciente pasa a ser p2.
    store().touch(key('p1'))
    store().touch(key('p21'))
    expect(store().order).toHaveLength(20)
    expect(Object.keys(store().tables)).toHaveLength(20)
    expect(store().order).not.toContain(key('p2'))
    expect(store().order).toContain(key('p1'))
    expect(store().get(key('p1')).expanded).toEqual(['e1'])
    // El expulsado, si vuelve, empieza limpio.
    expect(store().get(key('p2'))).toEqual(INITIAL_EVIDENCE_TABLE)
    expect(store().order.at(-1)).toBe(key('p21'))
  })

  it('update también recorta a 20', () => {
    for (let i = 1; i <= 25; i += 1) store().update(key(`p${i}`), { expanded: [`e${i}`] })
    expect(store().order).toHaveLength(20)
    expect(store().order[0]).toBe(key('p6'))
    expect(store().get(key('p5'))).toEqual(INITIAL_EVIDENCE_TABLE)
  })

  it('get no reordena ni cuenta como uso', () => {
    store().touch(key('a'))
    store().touch(key('b'))
    store().get(key('a'))
    expect(store().order).toEqual([key('a'), key('b')])
    // Tras 19 más, a (no "usado" por get) es el que sale.
    for (let i = 1; i <= 19; i += 1) {
      store().get(key('a'))
      store().touch(key(`n${i}`))
    }
    expect(store().order).not.toContain(key('a'))
    expect(store().order).toContain(key('b'))
  })

  it('toggleExpanded añade y quita, sin duplicados ni tocar a los demás', () => {
    store().touch(key('a'))
    store().toggleExpanded(key('a'), 'e1')
    store().toggleExpanded(key('a'), 'e2')
    expect(store().get(key('a')).expanded).toEqual(['e1', 'e2'])
    store().toggleExpanded(key('a'), 'e1')
    expect(store().get(key('a')).expanded).toEqual(['e2'])
    store().toggleExpanded(key('a'), 'e1')
    expect(
      store()
        .get(key('a'))
        .expanded.filter((id) => id === 'e1')
    ).toHaveLength(1)
    expect(store().get(key('b')).expanded).toEqual([])
  })

  it('no comparte objetos: cambiar un problema no altera INITIAL ni a otro', () => {
    store().update(key('a'), { expanded: ['e1'] })
    store().toggleExpanded(key('b'), 'e2')
    expect(INITIAL_EVIDENCE_TABLE.expanded).toEqual([])
    expect(INITIAL_EVIDENCE_TABLE.filters).toEqual(EMPTY_EVIDENCE_FILTERS)
    expect(store().get(key('a')).expanded).toEqual(['e1'])
    expect(store().get(key('c'))).toEqual(INITIAL_EVIDENCE_TABLE)
  })
})
