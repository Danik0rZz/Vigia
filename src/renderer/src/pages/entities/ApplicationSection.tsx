import type { JSX, ReactNode } from 'react'

/** Las secciones de la página de una aplicación web, en su orden (ficha 0053). */
export type ApplicationSectionId = 'activity' | 'errors' | 'apdex' | 'key-actions'

/**
 * Una sección con título de la página de una aplicación web (ficha 0053): «Actividad»,
 * «Errores», «Apdex» y «Acciones clave», entre los marcadores e «Información». Los gráficos van
 * de dos en dos con la ventana ancha (una columna por debajo de 1024 px).
 */
export function ApplicationSection({
  id,
  title,
  columns = true,
  children
}: {
  id: ApplicationSectionId
  title: string
  /** Rejilla de dos columnas para los gráficos; sin ella, el contenido ocupa todo el ancho. */
  columns?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <section
      data-testid="application-section"
      data-section={id}
      aria-label={title}
      className="grid min-w-0 gap-3"
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      {columns ? <div className="grid gap-4 lg:grid-cols-2">{children}</div> : children}
    </section>
  )
}
