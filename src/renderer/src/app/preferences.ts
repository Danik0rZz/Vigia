import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ThemePreference } from '@shared/ipc'

export type Language = 'es' | 'en'
export const LANGUAGES: readonly Language[] = ['es', 'en']

interface PreferencesState {
  theme: ThemePreference
  language: Language
  sidebarCollapsed: boolean
  setTheme: (theme: ThemePreference) => void
  setLanguage: (language: Language) => void
  toggleSidebar: () => void
}

/**
 * Preferencias de interfaz del usuario. Se guardan en el almacenamiento local
 * de la ventana (dentro de `userData`); no son datos de negocio.
 */
export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'system',
      language: 'es',
      sidebarCollapsed: false,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
    }),
    {
      name: 'vigia.preferences',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ theme, language, sidebarCollapsed }) => ({ theme, language, sidebarCollapsed })
    }
  )
)
