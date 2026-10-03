import type { JSX } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { RouterProvider } from 'react-router'
import { router } from './app/router'
import { queryClient } from './data/tenants'

export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Las animaciones de Motion respetan `prefers-reduced-motion`. */}
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
      </MotionConfig>
    </QueryClientProvider>
  )
}
