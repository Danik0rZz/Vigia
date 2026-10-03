import type { ThemePreference } from '@shared/ipc'
import type { IpcImplementation, IpcImplementations } from '../handler'

type UiHandlers = Pick<IpcImplementations, 'ui:setTheme'>

/**
 * Canales `ui:*`. `setThemeSource` aplica la preferencia a `nativeTheme` y
 * devuelve si el tema resultante es oscuro; se inyecta para probar sin Electron.
 */
export function createUiHandlers(deps: {
  setThemeSource: (theme: ThemePreference) => boolean
}): UiHandlers {
  const setTheme: IpcImplementation<'ui:setTheme'> = ({ theme }) => ({
    dark: deps.setThemeSource(theme)
  })

  return { 'ui:setTheme': setTheme }
}
