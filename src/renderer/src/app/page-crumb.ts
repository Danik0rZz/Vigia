import { create } from 'zustand'

interface PageCrumbState {
  /** Último tramo de la ruta en una página dentro de una sección (por ejemplo, "P-1234"). */
  detail: string | null
  setDetail: (detail: string | null) => void
}

/**
 * Lo que una página de detalle añade a la ruta de la barra superior. La barra
 * no sabe qué es un problema: la página pone su nombre y lo quita al salir.
 */
export const usePageCrumb = create<PageCrumbState>()((set) => ({
  detail: null,
  setDetail: (detail) => set({ detail })
}))
