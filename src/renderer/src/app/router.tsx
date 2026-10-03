import type { ComponentType } from 'react'
import { createHashRouter, Navigate, type RouteObject } from 'react-router'
import { HomePage } from '../pages/HomePage'
import { MetricsPage } from '../pages/MetricsPage'
import { ProblemsPage } from '../pages/ProblemsPage'
import { SectionPage } from '../pages/SectionPage'
import { SettingsPage } from '../pages/SettingsPage'
import { Layout } from './Layout'
import { NAV_SECTIONS } from './navigation'

/** Secciones con página propia; el resto muestra la página vacía genérica. */
const PAGES: Partial<Record<string, ComponentType>> = {
  home: HomePage,
  problems: ProblemsPage,
  metrics: MetricsPage,
  settings: SettingsPage
}

const sectionRoutes: RouteObject[] = NAV_SECTIONS.map((section) => {
  const Page = PAGES[section.id]
  const element = Page !== undefined ? <Page /> : <SectionPage section={section} />
  return section.path === '/' ? { index: true, element } : { path: section.path.slice(1), element }
})

/** Rutas hash: `BrowserRouter` falla al cargar la app por `app://`. */
export const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [...sectionRoutes, { path: '*', element: <Navigate to="/" replace /> }]
  }
])
