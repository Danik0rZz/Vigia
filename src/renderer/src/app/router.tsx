import type { ComponentType } from 'react'
import { createHashRouter, type RouteObject } from 'react-router'
import { HomePage } from '../pages/HomePage'
import { MetricsPage } from '../pages/MetricsPage'
import { ProblemDetailPage } from '../pages/ProblemDetailPage'
import { ProblemsPage } from '../pages/ProblemsPage'
import { SectionPage } from '../pages/SectionPage'
import { SettingsPage } from '../pages/SettingsPage'
import { ErrorTrigger } from './ErrorTrigger'
import { Layout } from './Layout'
import { NAV_SECTIONS } from './navigation'
import { NotFound, RouteError } from './RouteError'

/** Secciones con página propia; el resto muestra la página vacía genérica. */
const PAGES: Partial<Record<string, ComponentType>> = {
  home: HomePage,
  problems: ProblemsPage,
  metrics: MetricsPage,
  settings: SettingsPage
}

// Cada ruta con su errorElement: el error ocupa el área de contenido y el menú sigue.
const sectionRoutes: RouteObject[] = NAV_SECTIONS.map((section) => {
  const Page = PAGES[section.id]
  const element = Page !== undefined ? <Page /> : <SectionPage section={section} />
  const errorElement = <RouteError />
  return section.path === '/'
    ? { index: true, element, errorElement }
    : { path: section.path.slice(1), element, errorElement }
})

/**
 * Árbol de rutas. `errorTrigger` (lo decide main: solo sin empaquetar y con
 * VIGIA_E2E=1) añade /__errors/:variant, que provoca cada pantalla de error;
 * en la app empaquetada esa ruta no existe.
 */
export function buildRoutes({ errorTrigger }: { errorTrigger: boolean }): RouteObject[] {
  return [
    {
      path: '/',
      element: <Layout />,
      // Si falla el propio layout: pantalla completa.
      errorElement: <RouteError />,
      children: [
        ...sectionRoutes,
        // Página dentro de Problemas, no una sección del menú (NAV_SECTIONS no cambia).
        {
          path: 'problems/:problemId',
          element: <ProblemDetailPage />,
          errorElement: <RouteError />
        },
        ...(errorTrigger
          ? [{ path: '__errors/:variant', element: <ErrorTrigger />, errorElement: <RouteError /> }]
          : []),
        { path: '*', element: <NotFound /> }
      ]
    }
  ]
}

/** Rutas hash: `BrowserRouter` falla al cargar la app por `app://`. */
export function createAppRouter(options: {
  errorTrigger: boolean
}): ReturnType<typeof createHashRouter> {
  return createHashRouter(buildRoutes(options))
}
