import { describe, expect, it } from 'vitest'
import { listNotice } from './list-notice'

/**
 * Aviso bajo una lista: truncada por la API, filtrada en local (clúster) o las
 * dos cosas. Devuelve la clave i18n y sus parámetros, o null si no hay nada que decir.
 */

describe('listNotice', () => {
  it('sin filtro y sin truncar → null', () => {
    expect(
      listNotice({ shown: 10, loaded: 10, total: 10, truncated: false, filtered: false })
    ).toBeNull()
    expect(
      listNotice({ shown: 0, loaded: 0, total: null, truncated: false, filtered: false })
    ).toBeNull()
  })

  it('sin filtro, truncada y con total → module.truncatedOf { shown, total }', () => {
    expect(
      listNotice({ shown: 500, loaded: 500, total: 1234, truncated: true, filtered: false })
    ).toEqual({
      key: 'module.truncatedOf',
      params: { shown: 500, total: 1234 }
    })
  })

  it('sin filtro, truncada y sin total → module.truncated { count }', () => {
    expect(
      listNotice({ shown: 500, loaded: 500, total: null, truncated: true, filtered: false })
    ).toEqual({
      key: 'module.truncated',
      params: { count: 500 }
    })
  })

  it('con filtro y sin truncar → module.filteredOf { shown, loaded }', () => {
    expect(
      listNotice({ shown: 3, loaded: 40, total: 40, truncated: false, filtered: true })
    ).toEqual({
      key: 'module.filteredOf',
      params: { shown: 3, loaded: 40 }
    })
  })

  it('con filtro, truncada y con total → module.filteredOfTotal { shown, loaded, total }', () => {
    expect(
      listNotice({ shown: 3, loaded: 500, total: 1234, truncated: true, filtered: true })
    ).toEqual({
      key: 'module.filteredOfTotal',
      params: { shown: 3, loaded: 500, total: 1234 }
    })
  })

  it('con filtro, truncada y sin total → module.filteredOfFirst { shown, loaded }', () => {
    expect(
      listNotice({ shown: 3, loaded: 500, total: null, truncated: true, filtered: true })
    ).toEqual({
      key: 'module.filteredOfFirst',
      params: { shown: 3, loaded: 500 }
    })
  })

  it('con filtro que no deja nada fuera (shown = 0) también avisa', () => {
    expect(
      listNotice({ shown: 0, loaded: 40, total: 40, truncated: false, filtered: true })
    ).toEqual({
      key: 'module.filteredOf',
      params: { shown: 0, loaded: 40 }
    })
  })
})
