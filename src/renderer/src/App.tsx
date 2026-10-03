import { useEffect, useState, type FormEvent, type JSX } from 'react'
import type { IpcOutput } from '@shared/ipc'
import { invoke, IpcError } from './lib/ipc'

type AppInfo = IpcOutput<'app:getInfo'>

type PingState =
  | { status: 'idle' }
  | { status: 'ok'; reply: string; receivedAt: string }
  | { status: 'error'; message: string }

function errorMessage(error: unknown): string {
  if (error instanceof IpcError) return `${error.code}: ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

/**
 * Pantalla provisional de la Fase 1: demuestra que la ventana arranca y que el
 * canal IPC de ejemplo funciona de punta a punta. La Fase 2 la sustituye por el
 * layout real y mueve los textos a i18next.
 */
export default function App(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [message, setMessage] = useState('hola')
  const [ping, setPing] = useState<PingState>({ status: 'idle' })

  useEffect(() => {
    let cancelled = false
    invoke('app:getInfo')
      .then((data) => {
        if (!cancelled) setInfo(data)
      })
      .catch((error: unknown) => {
        if (!cancelled) setInfoError(errorMessage(error))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handlePing(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    try {
      const result = await invoke('app:ping', { message })
      setPing({ status: 'ok', ...result })
    } catch (error) {
      setPing({ status: 'error', message: errorMessage(error) })
    }
  }

  return (
    <main className="shell">
      <header>
        <h1>Vigía</h1>
        <p className="muted">Fase 1 · base del proyecto</p>
      </header>

      <section className="panel" aria-labelledby="info-title">
        <h2 id="info-title">Entorno de ejecución</h2>
        {infoError !== null && (
          <p className="error" role="alert">
            {infoError}
          </p>
        )}
        {info !== null && (
          <dl data-testid="app-info">
            <dt>Versión</dt>
            <dd>{info.version}</dd>
            <dt>Electron</dt>
            <dd>{info.versions.electron}</dd>
            <dt>Chromium</dt>
            <dd>{info.versions.chrome}</dd>
            <dt>Node</dt>
            <dd>{info.versions.node}</dd>
            <dt>Plataforma</dt>
            <dd>{info.platform}</dd>
            <dt>Empaquetada</dt>
            <dd>{info.packaged ? 'Sí' : 'No'}</dd>
          </dl>
        )}
      </section>

      <section className="panel" aria-labelledby="ping-title">
        <h2 id="ping-title">Canal IPC de ejemplo</h2>
        <form onSubmit={(event) => void handlePing(event)}>
          <label htmlFor="ping-message">Mensaje</label>
          <div className="row">
            <input
              id="ping-message"
              value={message}
              maxLength={200}
              onChange={(event) => setMessage(event.target.value)}
            />
            <button type="submit">Enviar a main</button>
          </div>
        </form>
        {ping.status === 'ok' && (
          <p data-testid="ping-reply">
            {ping.reply} <span className="muted">({ping.receivedAt})</span>
          </p>
        )}
        {ping.status === 'error' && (
          <p className="error" role="alert" data-testid="ping-error">
            {ping.message}
          </p>
        )}
      </section>
    </main>
  )
}
