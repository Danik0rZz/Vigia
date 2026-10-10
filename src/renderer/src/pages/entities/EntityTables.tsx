import type { JSX, ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { UsageLevel } from '../../lib/host-format'
import { MarkerError, MarkerSkeleton } from './EntityMarkers'

/*
 * Piezas comunes de las tablas de las páginas de entidad (ficha 0058, sacadas de las de host y
 * monitores): la tarjeta con su estado, las clases de las celdas y de las barras y el ancho de
 * una barra. El color del texto según el nivel es `LEVEL_CLASS` (`EntityMarkers.tsx`). Las
 * constantes viven junto a `TableCard`, como pide la ficha: de ahí los avisos de `react-refresh`
 * desactivados.
 */

/** Celda de un número en una tabla de entidad. */
export const NUMBER_CELL = 'px-2 py-2 whitespace-nowrap tabular-nums'

/** Color de la barra según el nivel (el nivel lleva además su texto en la celda). */
// eslint-disable-next-line react-refresh/only-export-components
export const BAR_CLASS: Record<UsageLevel, string> = {
  normal: 'bg-accent',
  warning: 'bg-status-warning',
  error: 'bg-danger'
}

/** Ancho de una barra de 0 a 100; sin dato, vacía. */
// eslint-disable-next-line react-refresh/only-export-components
export function barWidth(pct: number | null): number {
  return pct === null || !Number.isFinite(pct) ? 0 : Math.min(100, Math.max(0, pct))
}

/** Tarjeta de una tabla: título, y carga, aviso de error, vacío o el contenido. */
export function TableCard<T>({
  testId,
  title,
  empty,
  query,
  isEmpty,
  children
}: {
  testId: string
  title: string
  empty: string
  query: UseQueryResult<T>
  isEmpty: (data: T) => boolean
  children: (data: T) => ReactNode
}): JSX.Element {
  const data = query.data
  let body: ReactNode
  if (query.isError) {
    body = (
      <MarkerError
        error={query.error}
        busy={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    )
  } else if (data === undefined) {
    body = <MarkerSkeleton />
  } else if (isEmpty(data)) {
    body = <p className="text-sm text-muted-foreground">{empty}</p>
  } else {
    body = children(data)
  }
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="glass grid min-w-0 content-start gap-3 rounded-xl p-4"
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      {body}
    </section>
  )
}
