import type { RouteObject } from 'react-router'
import { describe, expect, it } from 'vitest'
import { buildRoutes } from './router'

/**
 * v0.10.1: la ruta del disparador de errores (/__errors/:variant) solo existe
 * en modo e2e (sin empaquetar y con VIGIA_E2E=1). En uso normal no está en el
 * árbol, así que /__errors/... cae en el 404 propio.
 */

/** Todas las rutas del árbol, con su path completo. */
function paths(routes: readonly RouteObject[], parent = ''): string[] {
  return routes.flatMap((route) => {
    const own =
      route.path === undefined
        ? parent
        : `${parent.replace(/\/$/, '')}/${route.path.replace(/^\//, '')}`
    return [own, ...paths(route.children ?? [], own)]
  })
}

describe('buildRoutes', () => {
  it('con errorTrigger false: ninguna ruta /__errors', () => {
    const all = paths(buildRoutes({ errorTrigger: false }))
    expect(all.some((path) => path.includes('__errors'))).toBe(false)
  })

  it('con errorTrigger true: /__errors/:variant existe', () => {
    const all = paths(buildRoutes({ errorTrigger: true }))
    expect(all).toContain('/__errors/:variant')
  })

  it('el resto del árbol es el mismo con y sin disparador', () => {
    const without = paths(buildRoutes({ errorTrigger: false }))
    const withTrigger = paths(buildRoutes({ errorTrigger: true })).filter(
      (path) => !path.includes('__errors')
    )
    expect(withTrigger).toEqual(without)
    // Las páginas de siempre siguen ahí.
    expect(without).toContain('/problems/:problemId')
  })
})
