import type { JSX } from 'react'

/** Cabecera de página. Subtítulo y acciones se añaden cuando cada módulo los tenga. */
export function PageHeader({ title }: { title: string }): JSX.Element {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    </header>
  )
}
