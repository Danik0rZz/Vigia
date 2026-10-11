import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { UseQueryResult } from '@tanstack/react-query'
import { all, byTag, parse, textOf, type HtmlNode } from '../../../../test/html-tree'

/**
 * Ficha 0081: el aviso de un marcador (`MarkerError`, y `QueryState` cuando el canal falla)
 * lleva `role="alert"` por defecto, como hoy; con la propiedad opcional `silent`, no lo lleva,
 * pero sigue enseñando su texto y «Reintentar». Se pinta en servidor con `t` simulado (devuelve
 * la clave), así que los textos se comprueban por su clave.
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const { MarkerError, QueryState } = await import('./EntityMarkers')

const LOAD_ERROR = 'entities.service.markers.loadError'
const RETRY = 'errorScreen.retry'

const render = (element: ReturnType<typeof createElement>): HtmlNode =>
  parse(renderToStaticMarkup(element))

const alerts = (tree: HtmlNode): HtmlNode[] =>
  all(tree).filter((node) => node.attrs['role'] === 'alert')

const retryButtons = (tree: HtmlNode): HtmlNode[] =>
  byTag(tree, 'button').filter((button) => textOf(button) === RETRY)

/** Una consulta fallida, lo justo que lee `QueryState`. */
const failedQuery = {
  isError: true,
  error: new Error('fallo simulado'),
  isFetching: false,
  data: undefined,
  refetch: () => Promise.resolve()
} as unknown as UseQueryResult<number>

/** La función hija de QueryState (en un .ts no hay JSX), aparte para pasarla como prop. */
const withValue = { children: (): string => 'valor' }

describe('CA4 (0081): MarkerError y QueryState, con role="alert" por defecto y sin él con silent', () => {
  it('MarkerError sin la propiedad nueva lleva role="alert", con su texto y Reintentar', () => {
    const tree = render(
      createElement(MarkerError, { error: new Error('fallo'), busy: false, onRetry: () => {} })
    )
    expect(alerts(tree)).toHaveLength(1)
    expect(textOf(tree)).toContain(LOAD_ERROR)
    expect(retryButtons(tree)).toHaveLength(1)
  })

  it('MarkerError con silent no lleva role="alert" y sigue con su texto y Reintentar', () => {
    const tree = render(
      createElement(MarkerError, {
        error: new Error('fallo'),
        busy: false,
        onRetry: () => {},
        silent: true
      })
    )
    expect(alerts(tree)).toHaveLength(0)
    expect(all(tree).filter((node) => node.attrs['role'] !== undefined)).toHaveLength(0)
    expect(textOf(tree)).toContain(LOAD_ERROR)
    expect(retryButtons(tree)).toHaveLength(1)
  })

  it('QueryState con el canal fallando y sin la propiedad nueva pinta el aviso con role="alert"', () => {
    const tree = render(
      createElement(QueryState<number>, {
        query: failedQuery,
        enabled: true,
        ...withValue
      })
    )
    expect(alerts(tree)).toHaveLength(1)
    expect(textOf(tree)).toContain(LOAD_ERROR)
    expect(retryButtons(tree)).toHaveLength(1)
  })

  it('QueryState con silent pinta el aviso sin role="alert", con su texto y Reintentar', () => {
    const tree = render(
      createElement(QueryState<number>, {
        query: failedQuery,
        enabled: true,
        silent: true,
        ...withValue
      })
    )
    expect(alerts(tree)).toHaveLength(0)
    expect(textOf(tree)).toContain(LOAD_ERROR)
    expect(retryButtons(tree)).toHaveLength(1)
    expect(textOf(tree)).not.toContain('valor')
  })
})
