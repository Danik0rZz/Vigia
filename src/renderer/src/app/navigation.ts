import {
  Activity,
  TriangleAlert,
  Briefcase,
  ChartLine,
  House,
  Network,
  Plug,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Target,
  Workflow,
  type LucideIcon
} from 'lucide-react'

export type NavGroupId = 'monitoring' | 'analysis' | 'administration'

export interface NavSection {
  id: string
  /** Ruta hash (`#/problems`). */
  path: string
  /** Clave i18n del nombre de la sección (`nav.<id>`). */
  labelKey: string
  /** Grupo de la barra lateral; `null` para Ajustes, que va en el pie. */
  group: NavGroupId | null
  icon: LucideIcon
}

export const NAV_GROUPS: readonly NavGroupId[] = ['monitoring', 'analysis', 'administration']

function section(id: string, path: string, group: NavGroupId | null, icon: LucideIcon): NavSection {
  return { id, path, labelKey: `nav.${id}`, group, icon }
}

/**
 * Lista única de secciones. De ella salen el menú, las rutas hash y la paleta
 * Ctrl+K: una sección nueva se añade aquí y en los locales, y en ningún otro sitio.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  section('home', '/', 'monitoring', House),
  section('problems', '/problems', 'monitoring', TriangleAlert),
  section('topology', '/topology', 'monitoring', Network),
  section('metrics', '/metrics', 'monitoring', ChartLine),
  section('logs', '/logs', 'monitoring', ScrollText),
  section('slos', '/slos', 'monitoring', Target),
  section('serviceFlows', '/service-flows', 'analysis', Workflow),
  section('businessView', '/business', 'analysis', Briefcase),
  section('configuration', '/configuration', 'administration', SlidersHorizontal),
  section('integrations', '/integrations', 'administration', Plug),
  section('settings', '/settings', null, Settings)
]

/** Icono de la app en la barra lateral. */
export const AppIcon = Activity
