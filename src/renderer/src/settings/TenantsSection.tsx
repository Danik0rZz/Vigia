import { useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import type { Client, EnvironmentView, ImportSummary } from '@shared/tenants'
import { ConfirmDialog, FormDialog } from '../components/dialogs'
import { EnvTypeBadge } from '../components/EnvTypeBadge'
import { BUTTON_ICON, BUTTON_PRIMARY, BUTTON_SECONDARY } from '../components/styles'
import { useTenantMutation, useTenants } from '../data/tenants'
import { IpcError } from '../lib/ipc'
import { ClientForm } from './ClientForm'
import { EnvironmentForm } from './EnvironmentForm'

const TYPE_TEXT: Record<EnvironmentView['type'], string> = {
  production: 'text-env-production',
  preproduction: 'text-env-preproduction',
  integration: 'text-env-integration',
  development: 'text-env-development',
  other: 'text-env-other'
}

/** Separador entre datos de una fila; es un signo, no texto traducible. */
const DOT = ' · '

type Editing =
  | { kind: 'client'; client: Client | null }
  | { kind: 'environment'; clientId: string; environmentId: string | null }
  | { kind: 'deleteClient'; client: Client }
  | { kind: 'deleteEnvironment'; environment: EnvironmentView }
  | null

type Notice =
  | { kind: 'exported' }
  | { kind: 'imported'; summary: ImportSummary }
  | { kind: 'error'; message: string }
  | null

function EnvironmentRow({
  environment,
  onEdit,
  onDelete
}: {
  environment: EnvironmentView
  onEdit: () => void
  onDelete: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <li
      data-testid="environment-row"
      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover"
    >
      <span className="font-medium">{environment.name}</span>
      <EnvTypeBadge type={environment.type} />
      {/* El texto del tipo lleva su color (contraste AA comprobado en env-colors.test). */}
      <span className={`text-xs font-medium ${TYPE_TEXT[environment.type]}`}>
        {t(`environmentTypes.${environment.type}`)}
      </span>
      <span className="flex gap-1.5 text-xs text-muted-foreground">
        {[
          t(`deployments.${environment.deployment}`),
          ...(environment.readOnly ? [t('tenants.readOnly')] : [])
        ].join(DOT)}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        data-testid="environment-edit"
        aria-label={t('tenants.edit')}
        title={t('tenants.edit')}
        onClick={onEdit}
        className={BUTTON_ICON}
      >
        <Pencil aria-hidden="true" className="size-3.5" />
      </button>
      <button
        type="button"
        data-testid="environment-delete"
        aria-label={t('tenants.delete')}
        title={t('tenants.delete')}
        onClick={onDelete}
        className={BUTTON_ICON}
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
      </button>
    </li>
  )
}

function ImportSummaryView({ summary }: { summary: ImportSummary }): JSX.Element {
  const { t } = useTranslation()
  const names = (items: { name: string }[]): string => items.map((item) => item.name).join(', ')
  return (
    <div data-testid="import-summary" className="grid gap-1 text-sm">
      <p>
        {t('importSummary.created', {
          clients: t('importSummary.clients', { count: summary.created.clients }),
          environments: t('importSummary.environments', { count: summary.created.environments })
        })}
      </p>
      {summary.skipped.length > 0 && (
        <p className="text-muted-foreground">
          {t('importSummary.skipped', { names: names(summary.skipped) })}
        </p>
      )}
      {summary.errors.length > 0 && (
        <p className="text-danger">{t('importSummary.errors', { names: names(summary.errors) })}</p>
      )}
    </div>
  )
}

/** Ajustes › Clientes y entornos: alta, edición y borrado, e importar o exportar la configuración. */
export function TenantsSection(): JSX.Element {
  const { t } = useTranslation()
  const { clients, environments } = useTenants()
  const [editing, setEditing] = useState<Editing>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const deleteClient = useTenantMutation('clients:delete')
  const deleteEnvironment = useTenantMutation('environments:delete')
  const exportConfig = useTenantMutation('config:export')
  const importConfig = useTenantMutation('config:import')
  const close = (): void => setEditing(null)

  const onExport = async (): Promise<void> => {
    try {
      const result = await exportConfig.mutateAsync([])
      setNotice(result.status === 'saved' ? { kind: 'exported' } : null)
    } catch {
      setNotice({ kind: 'error', message: 'errors.generic' })
    }
  }

  const onImport = async (): Promise<void> => {
    try {
      const result = await importConfig.mutateAsync([])
      setNotice(result.status === 'done' ? { kind: 'imported', summary: result.summary } : null)
    } catch (error) {
      const invalid = error instanceof IpcError && error.code === 'INVALID_INPUT'
      setNotice({ kind: 'error', message: invalid ? 'errors.invalidFile' : 'errors.generic' })
    }
  }

  return (
    <section className="glass grid gap-4 rounded-xl p-5" aria-labelledby="tenants-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="tenants-title" className="flex-1 font-semibold">
          {t('tenants.title')}
        </h2>
        <button
          type="button"
          data-testid="config-import"
          onClick={() => void onImport()}
          className={BUTTON_SECONDARY}
        >
          <Upload aria-hidden="true" className="size-4" />
          {t('tenants.import')}
        </button>
        <button
          type="button"
          data-testid="config-export"
          onClick={() => void onExport()}
          className={BUTTON_SECONDARY}
        >
          <Download aria-hidden="true" className="size-4" />
          {t('tenants.export')}
        </button>
        <button
          type="button"
          data-testid="client-add"
          onClick={() => setEditing({ kind: 'client', client: null })}
          className={BUTTON_PRIMARY}
        >
          <Plus aria-hidden="true" className="size-4" />
          {t('tenants.addClient')}
        </button>
      </div>

      {notice?.kind === 'exported' && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('tenants.exported')}
        </p>
      )}
      {notice?.kind === 'error' && (
        <p role="alert" className="text-sm text-danger">
          {t(notice.message)}
        </p>
      )}

      {clients.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tenants.empty')}</p>
      ) : (
        <ul className="grid gap-3">
          {clients.map((client) => {
            const own = environments.filter((environment) => environment.clientId === client.id)
            return (
              <li
                key={client.id}
                data-testid="client-row"
                className="grid gap-1 rounded-lg border border-border p-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-full"
                    // El color es un dato del usuario, no un token del tema.
                    style={{ backgroundColor: client.color }}
                  />
                  <span className="flex-1 font-semibold">{client.name}</span>
                  <button
                    type="button"
                    data-testid="environment-add"
                    onClick={() =>
                      setEditing({ kind: 'environment', clientId: client.id, environmentId: null })
                    }
                    className={BUTTON_SECONDARY}
                  >
                    <Plus aria-hidden="true" className="size-4" />
                    {t('tenants.addEnvironment')}
                  </button>
                  <button
                    type="button"
                    data-testid="client-edit"
                    aria-label={t('tenants.edit')}
                    title={t('tenants.edit')}
                    onClick={() => setEditing({ kind: 'client', client })}
                    className={BUTTON_ICON}
                  >
                    <Pencil aria-hidden="true" className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    data-testid="client-delete"
                    aria-label={t('tenants.delete')}
                    title={t('tenants.delete')}
                    onClick={() => setEditing({ kind: 'deleteClient', client })}
                    className={BUTTON_ICON}
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                  </button>
                </div>
                {own.length === 0 ? (
                  <p className="px-2 text-xs text-muted-foreground">
                    {t('tenants.noEnvironments')}
                  </p>
                ) : (
                  <ul className="grid">
                    {own.map((environment) => (
                      <EnvironmentRow
                        key={environment.id}
                        environment={environment}
                        onEdit={() =>
                          setEditing({
                            kind: 'environment',
                            clientId: client.id,
                            environmentId: environment.id
                          })
                        }
                        onDelete={() => setEditing({ kind: 'deleteEnvironment', environment })}
                      />
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {editing?.kind === 'client' && <ClientForm client={editing.client} onClose={close} />}
      {editing?.kind === 'environment' && (
        <EnvironmentForm
          clientId={editing.clientId}
          environmentId={editing.environmentId}
          onClose={close}
        />
      )}
      <ConfirmDialog
        open={editing?.kind === 'deleteClient'}
        title={
          editing?.kind === 'deleteClient'
            ? t('confirm.deleteClient', { name: editing.client.name })
            : ''
        }
        description={t('confirm.deleteClientBody')}
        onCancel={close}
        onConfirm={() => {
          if (editing?.kind === 'deleteClient') deleteClient.mutate([{ id: editing.client.id }])
          close()
        }}
      />
      <ConfirmDialog
        open={editing?.kind === 'deleteEnvironment'}
        title={
          editing?.kind === 'deleteEnvironment'
            ? t('confirm.deleteEnvironment', { name: editing.environment.name })
            : ''
        }
        description={t('confirm.deleteEnvironmentBody')}
        onCancel={close}
        onConfirm={() => {
          if (editing?.kind === 'deleteEnvironment') {
            deleteEnvironment.mutate([{ id: editing.environment.id }])
          }
          close()
        }}
      />
      <FormDialog
        open={notice?.kind === 'imported'}
        onOpenChange={(open) => !open && setNotice(null)}
        title={t('importSummary.title')}
        testId="import-summary-dialog"
      >
        {notice?.kind === 'imported' && <ImportSummaryView summary={notice.summary} />}
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => setNotice(null)} className={BUTTON_PRIMARY}>
            {t('importSummary.close')}
          </button>
        </div>
      </FormDialog>
    </section>
  )
}
