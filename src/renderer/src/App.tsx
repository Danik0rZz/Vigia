import { useState, type JSX } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { RouterProvider } from 'react-router'
import { createAppRouter } from './app/router'
import { queryClient } from './data/tenants'

export default function App({ errorTrigger }: { errorTrigger: boolean }): JSX.Element {
  // Una vez: el árbol de rutas no cambia mientras la app está abierta.
  const [router] = useState(() => createAppRouter({ errorTrigger }))
  return (
    <QueryClientProvider client={queryClient}>
      {/* Las animaciones de Motion respetan `prefers-reduced-motion`. */}
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
      </MotionConfig>
    </QueryClientProvider>
  )
}
