import { Component, type ReactNode } from 'react'
import { queryClient } from '../data/tenants'
import { reportError } from '../lib/error-log'
import { PanelError } from './ErrorScreen'

/**
 * Error compacto para un panel (un gráfico o una tabla): si falla, lo demás de
 * la página sigue. Reintentar vuelve a pintarlo y pide de nuevo los datos.
 */
export class PanelBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error: error ?? new Error('null') }
  }

  override componentDidCatch(error: unknown): void {
    reportError(error, window.location.hash.replace(/^#/, ''))
  }

  private readonly retry = (): void => {
    void queryClient.refetchQueries({ type: 'active' })
    this.setState({ error: null })
  }

  override render(): ReactNode {
    if (this.state.error !== null) return <PanelError onRetry={this.retry} />
    return this.props.children
  }
}
