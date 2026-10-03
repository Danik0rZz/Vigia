import { useMemo, useRef, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { serviceHealth } from '@shared/service-health'
import { ExportMenu } from '../components/ExportMenu'
import { ModuleError, ModuleUnavailable, RefreshButton } from '../components/ModuleState'
import { PageHeader } from '../components/PageHeader'
import { useModuleAccess, useModuleRefresh, useProblems, useSlos } from '../data/modules'

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
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
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
    value === null
      ? '—'
      : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(value)

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
            <p className="text-3xl font-semibold tabular-nums">
              {open.data?.problems.length ?? '—'}
            </p>
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
                    { key: 'errorBudget', header: t('home.budget'), type: 'number' }
                  ],
                  rows: sloList.map((slo) => ({
                    name: slo.name,
                    status: slo.status,
                    value: slo.evaluatedPercentage,
                    target: slo.target,
                    errorBudget: slo.errorBudget
                  }))
                }}
              />
            }
          >
            <div ref={sloRef}>
              {sloList.length === 0 && slos.isSuccess && (
                <p className="text-sm text-muted-foreground">{t('home.noSlos')}</p>
              )}
              <ul className="grid gap-1.5 text-sm">
                {sloList.map((slo) => (
                  <li key={slo.id} className="grid gap-0.5">
                    <span className="flex justify-between gap-2">
                      <span className="truncate font-medium">{slo.name}</span>
                      <span
                        className={
                          slo.status === 'SUCCESS' ? 'text-muted-foreground' : 'text-danger'
                        }
                      >
                        {t(`home.sloStatus.${slo.status}`)}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {`${t('home.value')} ${percent(slo.evaluatedPercentage)} · ${t('home.target')} ${percent(slo.target)} · ${t('home.budget')} ${percent(slo.errorBudget)}`}
                    </span>
                  </li>
                ))}
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
