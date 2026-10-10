import { Component, type ReactNode } from 'react'
import { reportError } from '../lib/error-log'
import { PanelError } from './ErrorScreen'

/**
 * Error compacto para un panel (un gráfico o una tabla): si falla, lo demás de
 * la página sigue. Reintentar limpia el error y lo vuelve a pintar con lo que
 * hay en la caché, sin pedir nada (ADR-0004: cada petición gasta cuota). Quien
 * deba recargar sus datos pasa `onRetry` con su `refetch` (ficha 0064).
 */
export class PanelBoundary extends Component<
  { children: ReactNode; onRetry?: () => void },
  { error: unknown }
> {
  override state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error: error ?? new Error('null') }
  }

  override componentDidCatch(error: unknown): void {
    reportError(error, window.location.hash.replace(/^#/, ''))
  }

  private readonly retry = (): void => {
    this.props.onRetry?.()
    this.setState({ error: null })
  }

  override render(): ReactNode {
    if (this.state.error !== null) return <PanelError onRetry={this.retry} />
    return this.props.children
  }
}
