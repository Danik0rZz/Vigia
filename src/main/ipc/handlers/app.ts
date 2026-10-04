import { DomainError } from '../../errors'
import { isSafeExternalUrl } from '../../security/external-url'
import type { IpcImplementations, IpcImplementation } from '../handler'

export interface AppInfoSource {
  name: string
  version: string
  packaged: boolean
  platform: string
  versions: { electron: string; chrome: string; node: string }
}

type AppHandlers = Pick<IpcImplementations, 'app:getInfo' | 'app:ping' | 'app:openExternal'>

/**
 * Canales `app:*`. Los datos y funciones de Electron se inyectan para poder
 * probar los handlers sin arrancar la app.
 */
export function createAppHandlers(deps: {
  getInfo: () => AppInfoSource
  /** shell.openExternal: solo recibe URLs ya validadas. */
  openExternal: (url: string) => Promise<void>
  now?: () => Date
}): AppHandlers {
  const now = deps.now ?? (() => new Date())

  const getInfo: IpcImplementation<'app:getInfo'> = () => deps.getInfo()

  const ping: IpcImplementation<'app:ping'> = ({ message }) => ({
    reply: `pong: ${message}`,
    receivedAt: now().toISOString()
  })

  const openExternal: IpcImplementation<'app:openExternal'> = async ({ url }) => {
    if (!isSafeExternalUrl(url)) {
      // El mensaje no lleva la URL: podría traer credenciales.
      throw new DomainError('INVALID_INPUT', 'Solo se abren enlaces http o https.', {
        key: 'externalUrlRejected'
      })
    }
    await deps.openExternal(new URL(url).href)
    return { ok: true }
  }

  return { 'app:getInfo': getInfo, 'app:ping': ping, 'app:openExternal': openExternal }
}
