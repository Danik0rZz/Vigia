import { useEffect, useRef, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import type { EntityLocationState } from '../../app/entity-route'
import { Lighthouse } from '../../components/Lighthouse'
import { PageHeader } from '../../components/PageHeader'
import { BUTTON_SECONDARY } from '../../components/styles'

/** Lo que recibe cada página de entidad: el tipo y el id de la ruta, ya decodificados. */
export interface EntityPageProps {
  type: string
  id: string
}

/**
 * Armazón común de las páginas de entidad: cabecera con el nombre (o el id),
 * el tipo y el id, «Volver» y el contenido de la página. No pide nada a
 * Dynatrace: el nombre viaja en el estado de navegación (ficha 0003).
 */
export function EntityPageFrame({
  testId,
  id,
  typeText,
  actions,
  children
}: EntityPageProps & {
  /** `entity-page-<tipo en minúsculas>` o `entity-page-generic`. */
  testId: string
  /** Nombre del tipo en la interfaz (o el código tal cual, en la genérica). */
  typeText: string
  /** Acciones de la página junto a «Volver» (por ejemplo, «Actualizar»). */
  actions?: ReactNode
  children: ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as EntityLocationState | null
  const fromProblem = state?.fromProblem === true
  const name = state?.name !== undefined && state.name !== '' ? state.name : id
  const titleRef = useRef<HTMLHeadingElement>(null)

  // Al entrar, el foco va al título: los lectores de pantalla anuncian la página.
  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  // Desde el problema, atrás en el historial (la tabla de evidencias sigue como
  // estaba y no se vuelve a pedir el detalle); abierta directamente, a Problemas.
  const back = (): void => {
    if (fromProblem) void navigate(-1)
    else void navigate('/problems', { replace: true })
  }

  return (
    <div data-testid={testId} className="grid gap-4">
      <PageHeader
        title={name}
        titleRef={titleRef}
        subtitle={
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">{t('entities.typeLabel')}</dt>
              <dd data-testid="entity-page-type" className="break-all">
                {typeText}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">{t('entities.idLabel')}</dt>
              <dd data-testid="entity-page-id" className="font-mono break-all">
                {id}
              </dd>
            </div>
          </dl>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <button
              type="button"
              data-testid="entity-back"
              onClick={back}
              className={BUTTON_SECONDARY}
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              {t('entities.back')}
            </button>
          </div>
        }
      />
      {children}
    </div>
  )
}

/**
 * Secciones de una página de entidad, siempre en el mismo orden (ficha 0036): la fila de
 * etiquetas, justo debajo de la cabecera (ficha 0037), los avisos de
 * módulos sin acceso, los marcadores, los gráficos, las demás tarjetas (discos y procesos del
 * host, localizaciones y pasos de los monitores…) y, la última, la tarjeta «Información», que en
 * algunos tipos (el host) es muy alta. Una página nueva lo cumple con solo usar esta pieza.
 */
export function EntitySections({
  tags,
  notices,
  markers,
  charts,
  cards,
  info
}: {
  /** Las etiquetas como píldoras (`EntityTags`), antes que nada (ficha 0037). */
  tags: ReactNode
  /** Avisos de los módulos sin acceso (Métricas, Problemas). */
  notices?: ReactNode
  markers: ReactNode
  /** Sin acceso a Métricas no hay gráficos. */
  charts?: ReactNode
  /** Las demás tarjetas de la página, detrás de los gráficos. */
  cards?: ReactNode
  /** La tarjeta «Información», al final. */
  info: ReactNode
}): JSX.Element {
  return (
    <>
      {tags}
      {notices}
      {markers}
      {charts}
      {cards}
      {info}
    </>
  )
}

/** Bloque «Página en construcción» con el faro (que ya respeta reducir el movimiento). */
export function UnderConstruction({ text }: { text: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <section
      data-testid="entity-under-construction"
      className="glass grid justify-items-center gap-2 rounded-xl p-8 text-center"
    >
      <Lighthouse scene="search" />
      <h2 className="text-base font-semibold">{t('entities.underConstruction')}</h2>
      <p className="max-w-prose text-sm text-muted-foreground">{text}</p>
    </section>
  )
}
