import { useSyncExternalStore } from 'react'
import type { ThemePreference } from '@shared/ipc'
import { invoke } from '../lib/ipc'
import { usePreferences } from './preferences'

export type ResolvedTheme = 'light' | 'dark'

const darkQuery = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: dark)')

function subscribeSystemTheme(onChange: () => void): () => void {
  const query = darkQuery()
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** Tema aplicado en este momento (claro u oscuro), ya resuelto si es "Sistema". */
export function useResolvedTheme(): ResolvedTheme {
  const preference = usePreferences((state) => state.theme)
  const systemDark = useSyncExternalStore(subscribeSystemTheme, () => darkQuery().matches)
  return resolveTheme(preference, systemDark)
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

function applyTheme(): void {
  const { theme } = usePreferences.getState()
  document.documentElement.dataset['theme'] = resolveTheme(theme, darkQuery().matches)
}

function syncNativeTheme(theme: ThemePreference): void {
  // Los controles nativos y la barra de título siguen a `nativeTheme` en main.
  invoke('ui:setTheme', { theme }).catch(() => undefined)
}

/**
 * Tema de la interfaz: el CSS lo mueve `data-theme` en `<html>`, que el
 * renderer calcula con `prefers-color-scheme` (en caliente si la preferencia es
 * "Sistema"). Main recibe la preferencia para ajustar `nativeTheme`.
 */
export function initTheme(): void {
  applyTheme()
  syncNativeTheme(usePreferences.getState().theme)

  darkQuery().addEventListener('change', applyTheme)
  usePreferences.subscribe((state, previous) => {
    if (state.theme === previous.theme) return
    applyTheme()
    syncNativeTheme(state.theme)
  })
}
