import { createErrorThrottle, maskErrorDetails } from '@shared/error-report'
import type { IpcImplementations, IpcImplementation } from '../handler'

export interface AppInfoSource {
  name: string
  version: string
  packaged: boolean
  platform: string
  versions: { electron: string; chrome: string; node: string }
  errorTrigger: boolean
}

type AppHandlers = Pick<
  IpcImplementations,
  'app:getInfo' | 'app:ping' | 'app:logRendererError' | 'app:copyText'
>

/**
 * Canales `app:*`. Los datos de Electron se inyectan para poder probar los
 * handlers sin arrancar la app.
 */
export function createAppHandlers(deps: {
  getInfo: () => AppInfoSource
  /** Escribe en el log de main (ya enmascarado). */
  logError: (
    message: string,
    details: { stack: string | null; route: string; version: string }
  ) => void
  writeClipboardText: (text: string) => void | Promise<void>
  now?: () => Date
}): AppHandlers {
  const now = deps.now ?? (() => new Date())
  // El renderer ya frena, pero main no se fía: el suyo propio.
  const throttle = createErrorThrottle({ now: () => now().getTime() })

  const getInfo: IpcImplementation<'app:getInfo'> = () => deps.getInfo()

  const ping: IpcImplementation<'app:ping'> = ({ message }) => ({
    reply: `pong: ${message}`,
    receivedAt: now().toISOString()
  })

  const logRendererError: IpcImplementation<'app:logRendererError'> = ({
    message,
    stack,
    route,
    version
  }) => {
    const masked = maskErrorDetails(message)
    const maskedRoute = maskErrorDetails(route)
    if (!throttle.allow(masked, maskedRoute)) return { logged: false }
    deps.logError(masked, {
      stack: stack === null ? null : maskErrorDetails(stack),
      route: maskedRoute,
      version
    })
    return { logged: true }
  }

  const copyText: IpcImplementation<'app:copyText'> = async ({ text }) => {
    await deps.writeClipboardText(text)
    return { ok: true }
  }

  return {
    'app:getInfo': getInfo,
    'app:ping': ping,
    'app:logRendererError': logRendererError,
    'app:copyText': copyText
  }
}
