/*
 * Último recurso: si falla lo que está por encima del router, puede haber
 * fallado también i18next, el store o el tema. Por eso este fichero (y solo
 * este) lleva sus textos en español e inglés (en TEXTS, fuera del JSX: así
 * i18next/no-literal-string no necesita excepción) y estilos en línea.
 */
import { Component, useEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { maskErrorDetails } from '@shared/error-report'
import { describeError, errorLogVersion, reportError } from '../lib/error-log'

/** Evento con el que el disparador (/__errors/fatal) provoca un error aquí arriba. */
export const FATAL_TRIGGER_EVENT = 'vigia:fatal-trigger'

const TEXTS = {
  es: {
    title: 'Vigía no ha podido seguir',
    body: 'Ha fallado una parte básica de la interfaz. Recarga para volver a empezar; tus datos no se han tocado.',
    reload: 'Recargar',
    details: 'Detalles técnicos'
  },
  en: {
    title: 'Vigía could not continue',
    body: 'A core part of the interface failed. Reload to start again; your data has not been touched.',
    reload: 'Reload',
    details: 'Technical details'
  }
} as const

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    fontFamily: 'system-ui, "Segoe UI", sans-serif',
    background: '#0f172a',
    color: '#e2e8f0'
  },
  card: {
    maxWidth: 560,
    display: 'grid',
    gap: 12,
    textAlign: 'center',
    padding: 32,
    borderRadius: 12,
    background: '#1e293b',
    border: '1px solid #334155'
  },
  button: {
    justifySelf: 'center',
    padding: '8px 16px',
    borderRadius: 8,
    border: 'none',
    background: '#38bdf8',
    color: '#0f172a',
    fontWeight: 600,
    cursor: 'pointer'
  },
  pre: {
    textAlign: 'left',
    maxHeight: 220,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    fontSize: 12,
    padding: 12,
    borderRadius: 8,
    background: '#0f172a'
  }
}

function FatalScreen({ error }: { error: unknown }): JSX.Element {
  const texts = navigator.language.toLowerCase().startsWith('en') ? TEXTS.en : TEXTS.es
  const { message, stack } = describeError(error)
  const details = maskErrorDetails(
    [message, stack ?? '', `route: ${window.location.hash}`, `version: ${errorLogVersion()}`].join(
      '\n\n'
    )
  )
  return (
    <div style={styles['page']}>
      <div data-testid="fatal-error" role="alert" style={styles['card']}>
        <h1 style={{ fontSize: 20, margin: 0 }}>{texts.title}</h1>
        <p style={{ margin: 0, opacity: 0.8 }}>{texts.body}</p>
        <button
          type="button"
          data-testid="fatal-reload"
          autoFocus
          onClick={() => window.location.reload()}
          style={styles['button']}
        >
          {texts.reload}
        </button>
        <details data-testid="fatal-details" style={{ textAlign: 'left' }}>
          <summary style={{ cursor: 'pointer', opacity: 0.8 }}>{texts.details}</summary>
          <pre style={styles['pre']}>{details}</pre>
        </details>
      </div>
    </div>
  )
}

/** Solo con el disparador: lanza aquí arriba cuando llega su evento. */
export function FatalTrigger(): null {
  const [fail, setFail] = useState(false)
  useEffect(() => {
    const onTrigger = (): void => setFail(true)
    window.addEventListener(FATAL_TRIGGER_EVENT, onTrigger)
    return () => window.removeEventListener(FATAL_TRIGGER_EVENT, onTrigger)
  }, [])
  if (fail) throw new Error('Error de prueba del disparador (fatal)')
  return null
}

/**
 * Lo más alto de la app: atrapa lo que no atrapa el router (proveedores,
 * MotionConfig, el propio router) y enseña una pantalla mínima con Recargar.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error: error ?? new Error('null') }
  }

  override componentDidCatch(error: unknown): void {
    reportError(error, window.location.hash.replace(/^#/, ''))
  }

  override render(): ReactNode {
    if (this.state.error !== null) return <FatalScreen error={this.state.error} />
    return this.props.children
  }
}
