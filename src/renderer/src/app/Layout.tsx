import { useEffect, useState, type JSX } from 'react'
import { Outlet, useLocation } from 'react-router'
import { motion } from 'motion/react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { CommandPalette } from '../components/CommandPalette'
import { useActiveEnvironment } from '../data/tenants'
import { Sidebar } from '../components/Sidebar'
import { TopBar } from '../components/TopBar'

/** Estructura de la ventana: barra lateral, barra superior, contenido y paleta Ctrl+K. */
export function Layout(): JSX.Element {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const { pathname } = useLocation()
  const active = useActiveEnvironment()
  const accent = active?.client.color ?? null

  // El color de acento sigue al cliente activo; el distintivo de Producción no cambia.
  useEffect(() => {
    const root = document.documentElement.style
    if (accent === null) root.removeProperty('--accent')
    else root.setProperty('--accent', accent)
  }, [accent])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    // Un único proveedor de tooltips para toda la ventana.
    <Tooltip.Provider delayDuration={300}>
      <div className="flex h-full">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onOpenPalette={() => setPaletteOpen(true)} />
          <main className="flex-1 overflow-y-auto px-6 pt-2 pb-6">
            {/* Transición de entrada entre páginas; Motion la omite con movimiento reducido. */}
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <Outlet />
            </motion.div>
          </main>
        </div>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </Tooltip.Provider>
  )
}
