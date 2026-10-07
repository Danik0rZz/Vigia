import { useMemo, useRef, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { sloDisplayStatus } from '@shared/modules'
import { serviceHealth } from '@shared/service-health'
import { formatNumber } from '@shared/format-number'
import { ExportMenu } from '../components/ExportMenu'
import {
  ApiWarnings,
  ModuleError,
  ModuleUnavailable,
  RefreshButton,
  TruncatedNotice
} from '../components/ModuleState'
import { PageHeader } from '../components/PageHeader'
import { useModuleAccess, useModuleRefresh, useProblems, useSlos } from '../data/modules'

/** Color de cada estado de SLO (tokens de estado, no los de tipo de entorno). */
const SLO_STATUS_CLASS: Record<ReturnType<typeof sloDisplayStatus>, string> = {
  SUCCESS: 'text-muted-foreground',
  WARNING: 'text-status-warning',
  FAILURE: 'text-danger',
  UNEVALUATED: 'text-muted-foreground'
}

/** Dynatrace no pudo calcular los problemas relacionados (según la OpenAPI, -1). */
const relatedUnavailable = (slo: { relatedOpenProblems: number | null }): boolean =>
  slo.relatedOpenProblems !== null && slo.relatedOpenProblems < 0

/** Tarjeta con entrada escalonada (Motion respeta el movimiento reducido). */
function Card({
  index,
  title,
  actions,
  testId,
  children
}: {
  index: number
  title: string
  actions?: ReactNode
  testId: string
  children: ReactNode
}): JSX.Element {
  return (
    <motion.section
      data-testid={testId}
      aria-label={title}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.06 }}
      className="glass grid content-start gap-2 rounded-xl p-4"
    >
      {/* El título no encoge; lo que encoge son las acciones (el aviso de exportar). */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2 className="shrink-0 text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </motion.section>
  )
}

/** Inicio: problemas abiertos, SLOs y salud de servicios del entorno activo. */
export function HomePage(): JSX.Element {
  const { t, i18n } = useTranslation()
  const access = useModuleAccess('home')
  const envId = access.available ? access.envId : null
  const open = useProblems(envId, { status: 'open' })
  const slos = useSlos(envId)
  const refreshProblems = useModuleRefresh(envId, 'problems')
  const refreshHome = useModuleRefresh(envId, 'home')
  const sloRef = useRef<HTMLDivElement>(null)
  const healthRef = useRef<HTMLDivElement>(null)

  const services = useMemo(() => serviceHealth(open.data?.problems ?? []), [open.data])
  const percent = (value: number | null): string =>
    value === null ? '—' : formatNumber(value, i18n.language, { maximumFractionDigits: 2 })

  if (!access.available) {
    return (
      <>
        <PageHeader title={t('nav.home')} />
        <ModuleUnavailable access={access} />
      </>
    )
  }

  const sloList = slos.data?.slos ?? []

  return (
    <>
      <PageHeader title={t('nav.home')} />
      <div className="grid gap-4">
        <div className="flex justify-end">
          <RefreshButton
            onRefresh={() => {
              refreshProblems()
              refreshHome()
            }}
            busy={open.isFetching || slos.isFetching}
          />
        </div>
        {(open.error ?? slos.error) !== null && <ModuleError error={open.error ?? slos.error} />}

        <div className="grid gap-4 md:grid-cols-3">
          <Card index={0} title={t('home.openProblems')} testId="kpi-open-problems">
            {/* El total real de la API: la lista puede venir truncada. */}
            <p className="text-3xl font-semibold tabular-nums">
              {open.data === undefined ? '—' : (open.data.totalCount ?? open.data.problems.length)}
            </p>
            <ApiWarnings invalid={open.data?.invalid} />
            {open.data?.truncated === true && (
              <TruncatedNotice shown={open.data.problems.length} total={open.data.totalCount} />
            )}
          </Card>

          <Card
            index={1}
            title={t('home.slos')}
            testId="kpi-slos"
            actions={
              <ExportMenu
                target="kpi-slos"
                module="slos"
                element={sloRef}
                table={{
                  columns: [
                    { key: 'name', header: t('home.slos'), type: 'string' },
                    { key: 'status', header: t('problems.columns.status'), type: 'string' },
                    { key: 'value', header: t('home.value'), type: 'number' },
                    { key: 'target', header: t('home.target'), type: 'number' },
                    { key: 'errorBudget', header: t('home.budget'), type: 'number' },
                    {
                      key: 'relatedOpenProblems',
                      header: t('home.relatedOpenProblemsColumn'),
                      type: 'number'
                    }
                  ],
                  rows: sloList.map((slo) => ({
                    name: slo.name,
                    status: sloDisplayStatus(slo),
                    value: slo.evaluatedPercentage,
                    target: slo.target,
                    errorBudget: slo.errorBudget,
                    // Un cálculo fallido (-1) es un número no disponible: celda vacía (AUD-09).
                    relatedOpenProblems: relatedUnavailable(slo) ? null : slo.relatedOpenProblems
                  })),
                  ...(sloList.some(relatedUnavailable)
                    ? { note: t('home.relatedOpenProblemsEmpty') }
                    : {}),
                  invalidCount: slos.data?.invalid
                }}
              />
            }
          >
            <div ref={sloRef}>
              {sloList.length === 0 && slos.isSuccess && (
                <p className="text-sm text-muted-foreground">{t('home.noSlos')}</p>
              )}
              <ApiWarnings invalid={slos.data?.invalid} />
              {slos.data?.truncated === true && (
                <TruncatedNotice shown={sloList.length} total={slos.data.totalCount} />
              )}
              <ul className="grid gap-1.5 text-sm">
                {sloList.map((slo) => {
                  const status = sloDisplayStatus(slo)
                  return (
                    <li key={slo.id} className="grid gap-0.5">
                      <span className="flex justify-between gap-2">
                        <span className="truncate font-medium">{slo.name}</span>
                        {/* El texto del estado va siempre: el color no es la única señal. */}
                        <span
                          data-testid="slo-status"
                          data-status={status}
                          className={SLO_STATUS_CLASS[status]}
                        >
                          {t(`home.sloStatus.${status}`)}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {`${t('home.value')} ${percent(slo.evaluatedPercentage)} · ${t('home.target')} ${percent(slo.target)} · ${t('home.budget')} ${percent(slo.errorBudget)}`}
                      </span>
                      {/* -1 es que Dynatrace no pudo calcularlo: no se muestra nada. */}
                      {slo.relatedOpenProblems !== null && slo.relatedOpenProblems > 0 && (
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>
                            <span
                              data-testid="slo-related-problems"
                              tabIndex={0}
                              className="justify-self-start text-xs text-danger"
                            >
                              {t('home.relatedOpenProblems', { count: slo.relatedOpenProblems })}
                            </span>
                          </Tooltip.Trigger>
                          <Tooltip.Portal>
                            <Tooltip.Content
                              data-testid="slo-related-problems-tooltip"
                              sideOffset={6}
                              className="glass z-50 max-w-80 rounded-md px-3 py-2 text-xs text-foreground"
                            >
                              {t('home.relatedOpenProblemsHint')}
                            </Tooltip.Content>
                          </Tooltip.Portal>
                        </Tooltip.Root>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          </Card>

          <Card
            index={2}
            title={t('home.serviceHealth')}
            testId="service-health"
            actions={
              <ExportMenu
                target="service-health"
                module="home"
                element={healthRef}
                table={{
                  columns: [
                    { key: 'name', header: t('home.serviceHealth'), type: 'string' },
                    { key: 'severity', header: t('problems.columns.severity'), type: 'string' },
                    { key: 'problems', header: t('home.openProblems'), type: 'number' }
                  ],
                  rows: services.map(({ name, severity, problems }) => ({
                    name,
                    severity,
                    problems
                  }))
                }}
              />
            }
          >
            <div ref={healthRef}>
              {services.length === 0 && open.isSuccess && (
                <p className="text-sm text-muted-foreground">{t('home.noServices')}</p>
              )}
              <ul className="grid gap-1 text-sm">
                {services.map((service) => (
                  <li key={service.id} className="flex justify-between gap-2">
                    <span className="truncate">{service.name}</span>
                    <span className="text-danger">
                      {i18n.exists(`problems.severity.${service.severity}`)
                        ? t(`problems.severity.${service.severity}`)
                        : service.severity}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
