import type { JSX, ReactNode, Ref } from 'react'

/**
 * Cabecera de página: el título y, si la página los tiene, un subtítulo debajo
 * y acciones a la derecha. Con `titleRef`, el título se puede enfocar (las
 * páginas de detalle lo enfocan al entrar para que se anuncie).
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  titleRef
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  titleRef?: Ref<HTMLHeadingElement>
}): JSX.Element {
  const heading = (
    <h1
      ref={titleRef}
      tabIndex={titleRef === undefined ? undefined : -1}
      className="text-2xl font-semibold tracking-tight wrap-anywhere outline-none"
    >
      {title}
    </h1>
  )
  if (subtitle === undefined && actions === undefined) {
    return <header className="mb-6">{heading}</header>
  }
  return (
    <header className="mb-6 flex flex-wrap items-start gap-3">
      <div className="grid min-w-0 flex-1 gap-1">
        {heading}
        {subtitle}
      </div>
      {actions}
    </header>
  )
}
