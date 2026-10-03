import type { IpcImplementations, IpcImplementation } from '../handler'

export interface AppInfoSource {
  name: string
  version: string
  packaged: boolean
  platform: string
  versions: { electron: string; chrome: string; node: string }
}

type AppHandlers = Pick<IpcImplementations, 'app:getInfo' | 'app:ping'>

/**
 * Canales `app:*`. Los datos de Electron se inyectan para poder probar los
 * handlers sin arrancar la app.
 */
export function createAppHandlers(deps: {
  getInfo: () => AppInfoSource
  now?: () => Date
}): AppHandlers {
  const now = deps.now ?? (() => new Date())

  const getInfo: IpcImplementation<'app:getInfo'> = () => deps.getInfo()

  const ping: IpcImplementation<'app:ping'> = ({ message }) => ({
    reply: `pong: ${message}`,
    receivedAt: now().toISOString()
  })

  return { 'app:getInfo': getInfo, 'app:ping': ping }
}
