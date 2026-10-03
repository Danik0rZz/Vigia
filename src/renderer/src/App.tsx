import type { JSX } from 'react'
import { MotionConfig } from 'motion/react'
import { RouterProvider } from 'react-router'
import { router } from './app/router'

export default function App(): JSX.Element {
  return (
    // Las animaciones de Motion respetan `prefers-reduced-motion`.
    <MotionConfig reducedMotion="user">
      <RouterProvider router={router} />
    </MotionConfig>
  )
}
